import { NextResponse } from "next/server";
import { z } from "zod";
import { getOpenAI } from "@/lib/openai";
import { chatJson, type AskFn } from "@/lib/ai/chat";
import { recordOpenAiUsage } from "@/lib/usage/record";
import {
  fetchQuota,
  findDecisionMaker,
  findEmailByName,
  hasHunterKey,
} from "@/lib/enrichment/hunter";
import { toDomain } from "@/lib/enrichment/http";
import type { DecisionMakerContact, EnrichmentWarning } from "@/lib/enrichment/types";
import { buildFacts } from "@/lib/emails/derived-facts";
import {
  BRIEF_SCHEMA,
  runStrategist,
  validateBrief,
  type BriefAngle,
  type BriefOutcome,
  type HistoryMessage,
  type StrategistInput,
} from "@/lib/emails/strategist";
import { describesNeed, needConfidence } from "@/lib/emails/need-lead";
import { edges, maxSimilarity } from "@/lib/similarity";
import { coerceTone, type ToneKey } from "@/lib/tones";
import type { Prospect } from "@/types";
import { activeProspects } from "@/lib/trash/scope";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { draftFromBrief } from "./pipeline";
import type { Evidence } from "./prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Stratège + rédaction + juge, et jusqu'à une réécriture. */
export const maxDuration = 120;

const SIMILARITY_LIMIT = 0.4;
const HISTORY = 10;

const CONTACT_SCHEMA = z.object({
  email: z.string(),
  full_name: z.string().nullable(),
  position: z.string().nullable(),
  confidence: z.number().nullable(),
});

const ANGLE_SCHEMA = BRIEF_SCHEMA.shape.angle;

const BODY_SCHEMA = z.object({
  prospectId: z.string().min(1),
  tone: z.string().optional(),
  /**
   * - full        : chaîne complète, contact Hunter compris ;
   * - other_angle : relance UNIQUEMENT le stratège, angles précédents exclus.
   *                 Aucun appel Linkup, Pappers ni Hunter ;
   * - rewrite     : rédacteur seul, depuis le brief (éventuellement édité).
   */
  mode: z.enum(["full", "other_angle", "rewrite"]).default("full"),
  cachedContact: CONTACT_SCHEMA.nullish(),
  /** Angles déjà proposés, cumulés côté client pour faire tourner les angles. */
  excludeAngles: z.array(ANGLE_SCHEMA).max(10).optional(),
  /** Brief édité à la main, pour le mode `rewrite`. Revalidé ici. */
  brief: z.unknown().optional(),
});

/**
 * Recherche du contact nominatif — au moment du brouillon, jamais avant.
 *
 * Trois tentatives successives, et l'absence de contact est un resultat
 * acceptable : le mail commencera par « Bonjour, » et l'ecran affichera un
 * badge « sans contact nominatif ». Aucune etape ne peut faire echouer la
 * generation.
 */
async function findContact(
  prospect: Prospect,
): Promise<{ contact: DecisionMakerContact | null; warning?: EnrichmentWarning }> {
  const domain = toDomain(prospect.website);
  if (!domain) return { contact: null, warning: { source: "hunter", message: "aucun site connu" } };
  if (!hasHunterKey()) {
    return { contact: null, warning: { source: "hunter", message: "cle absente : decideur non recherche" } };
  }

  const figures = prospect.key_figures ?? {};
  const leaderPerson =
    typeof figures.leader_person === "string" ? figures.leader_person : null;
  const leader = typeof figures.leader === "string" ? figures.leader : null;

  // 1. Un decideur sur le domaine.
  const search = await findDecisionMaker(domain, leaderPerson ?? leader, prospect.id);
  if (search.ok && search.data) return { contact: search.data };

  if (!search.ok && search.quotaExceeded) {
    const quota = await fetchQuota();
    const detail = quota
      ? `quota atteint (${quota.used}/${quota.available} recherches du plan ${quota.planName ?? "en cours"})`
      : "quota de recherches atteint pour ce mois";
    return { contact: null, warning: { source: "hunter", message: detail } };
  }
  if (!search.ok) return { contact: null, warning: { source: "hunter", message: search.error } };

  // 2. L'adresse du dirigeant personne physique, reconstruite par Hunter.
  const parts = (leaderPerson ?? "").trim().split(/\s+/);
  if (parts.length >= 2) {
    const finder = await findEmailByName(domain, parts[0], parts.slice(1).join(" "), prospect.id);
    if (finder.ok && finder.data) return { contact: finder.data };
    if (!finder.ok && finder.quotaExceeded) {
      return { contact: null, warning: { source: "hunter", message: "quota de recherches atteint pour ce mois" } };
    }
  }

  // 3. Rien : on le dit, et on ecrit « Bonjour, ».
  return {
    contact: null,
    warning: { source: "hunter", message: "aucun contact nominatif trouve sur ce domaine" },
  };
}

/** Brief stocké avec le prospect, s'il est lisible. */
function storedAngle(prospect: Prospect): BriefAngle | null {
  const parsed = ANGLE_SCHEMA.safeParse((prospect.brief as { angle?: unknown } | null | undefined)?.angle);
  return parsed.success ? parsed.data : null;
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const parsedBody = BODY_SCHEMA.safeParse(await readJson<unknown>(request));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const body = parsedBody.data;
  const tone: ToneKey = coerceTone(body.tone);

  // Corbeille exclue : aucun crédit dépensé pour un prospect supprimé.
  const { data, error } = await activeProspects(session.supabase).eq("id", body.prospectId).single();
  const prospect = data as Prospect | null;

  if (error || !prospect) {
    return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });
  }
  // Un prospect perdu est clos : generer un mail pour lui, c'est relancer
  // quelqu'un qui a deja dit non, et payer des credits pour le faire.
  if (prospect.status === "perdu") {
    return NextResponse.json(
      { error: "Prospect clôturé : ce prospect est marqué « Perdu », la génération est désactivée." },
      { status: 409 },
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY absente : la génération est indisponible." },
      { status: 503 },
    );
  }

  const warnings: EnrichmentWarning[] = [];

  // Hors génération complète, AUCUN appel Linkup, Pappers ou Hunter : le
  // contact revient du client, les faits sont recalculés depuis la base.
  let contact: DecisionMakerContact | null = null;
  if (body.mode === "full") {
    const outcome = await findContact(prospect).catch(() => ({ contact: null, warning: undefined }));
    contact = outcome.contact;
    if (outcome.warning) warnings.push(outcome.warning);
  } else {
    contact = (body.cachedContact as DecisionMakerContact | null | undefined) ?? null;
  }

  // Les faits sont TOUJOURS recalcules cote serveur : le client n'est pas une
  // source de verite, meme pour des donnees qu'il a recues de nous.
  const factsResult = buildFacts(prospect, contact);
  const { facts, leaderPerson } = factsResult;
  for (const rejected of factsResult.rejectedSignals.filter((item) => item.reason === "homonyme probable")) {
    warnings.push({ source: "linkup", message: `signal écarté, homonyme probable : ${rejected.entity ?? rejected.label}` });
  }

  const ask: AskFn = (role, system, user, temperature, operation) =>
    chatJson({
      client: getOpenAI(),
      role,
      system,
      user,
      temperature,
      operation,
      onUsage: (usage) =>
        recordOpenAiUsage({
          model: usage.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          operation: usage.operation,
          prospectId: prospect.id,
        }),
    });

  // --- STRATÈGE -------------------------------------------------------------
  const sentResult = await session.supabase
    .from("messages")
    .select("subject, body, sent_at")
    .eq("prospect_id", prospect.id)
    .eq("status", "sent")
    .order("created_at", { ascending: true });
  const history = (sentResult.data ?? []) as HistoryMessage[];

  const figures = prospect.key_figures ?? {};
  const excludeAngles = [...(body.excludeAngles ?? [])];
  const previous = storedAngle(prospect);
  if (body.mode === "other_angle" && previous) excludeAngles.push(previous);

  const strategistInput: StrategistInput = {
    facts,
    companyName: factsResult.companyName,
    isLargeGroupSubsidiary: factsResult.isLargeGroupSubsidiary,
    parentGroup: (typeof figures.parent_group === "string" ? figures.parent_group : null) ?? factsResult.parent,
    foreignEntities: factsResult.foreignEntities,
    history,
    excludeAngles: body.mode === "full" ? [] : excludeAngles,
    // Sert a reperer un pain qui ne fait que redire l'activite de l'entreprise.
    sector: prospect.sector,
  };

  let outcome: BriefOutcome;
  if (body.mode === "rewrite") {
    // Brief édité à la main : revalidé comme une sortie du modèle, sans
    // re-tester l'exclusion (l'angle ne change pas, seul son texte bouge).
    outcome = validateBrief(body.brief, { ...strategistInput, excludeAngles: [] });
    if (outcome.brief) outcome.brief.excludedAngles = excludeAngles;
  } else {
    outcome = await runStrategist(
      (system, user, operation) => ask("strategist", system, user, 0.2, operation),
      strategistInput,
    );
  }
  if (!outcome.brief) {
    return NextResponse.json({ error: `Brief inexploitable : ${outcome.error}` }, { status: 502 });
  }
  const brief = outcome.brief;

  // Stocké avec le prospect : « Autre angle » s'en sert pour exclure l'angle.
  const saved = await session.supabase.from("prospects").update({ brief }).eq("id", prospect.id);
  if (saved.error) {
    warnings.push({
      source: "openai",
      message: "brief non enregistré : appliquez la migration 20260925100000_prospect_brief.sql",
    });
  }

  // --- RÉDACTEUR + JUGE -----------------------------------------------------
  // Anti-répétition : on interdit les ouvertures déjà servies, puis on MESURE.
  const historyResult = await session.supabase
    .from("messages")
    .select("body")
    .eq("type", "intro")
    .order("created_at", { ascending: false })
    .limit(HISTORY);
  const previousBodies = (historyResult.data ?? []).map((row) => (row as { body: string }).body);
  const avoid = previousBodies.flatMap((text) => {
    const { opening, closing } = edges(text);
    return [opening, closing].filter(Boolean);
  });

  const draft = await draftFromBrief({
    ask,
    brief,
    facts,
    tone,
    contact,
    prospectId: prospect.id,
    registryName: prospect.company_name,
    avoid,
    leaderPerson,
    forbiddenNames: factsResult.foreignEntities,
    judge: body.mode !== "rewrite",
  });
  if ("error" in draft) {
    return NextResponse.json({ error: draft.error }, { status: 502 });
  }
  const { email, validation, critique, failing } = draft;

  const similarity = maxSimilarity(email.body, previousBodies);
  if (similarity > SIMILARITY_LIMIT) {
    warnings.push({
      source: "openai",
      message: `Ce brouillon ressemble à ${Math.round(similarity * 100)} % à un mail déjà envoyé.`,
    });
  }

  if (contact && !prospect.email && body.mode === "full") {
    await session.supabase.from("prospects").update({ email: contact.email }).eq("id", prospect.id);
  }

  // « Indice de besoin » : l'insight du brief, s'il décrit une friction
  // opérationnelle ; la confiance se calcule sur ce qu'on a réellement.
  const leadText = brief.angle.insight;
  const siteRead = figures.site_status === "lu";
  const confidence = needConfidence({
    facts,
    hasSiteContent: siteRead,
    vocabularyConfirmed: Array.isArray(figures.site_vocabulary) && figures.site_vocabulary.length > 0,
  });
  const evidence: Evidence[] = facts.map((fact) => ({
    label: fact.label,
    value: fact.value,
    source: fact.source,
    ...(fact.url ? { url: fact.url } : {}),
  }));

  return NextResponse.json({
    pain_point: brief.pain.task,
    evidence,
    email,
    brief,
    facts,
    contact,
    warnings,
    critique,
    /** Les points qui n'ont pas pu être corrigés : l'UI affiche « à revoir ». */
    needsReview: !validation.ok || failing.length > 0,
    reviewReasons: [...validation.failures, ...failing],
    needLead: describesNeed(`${leadText} ${brief.pain.task}`)
      ? {
          text: leadText,
          factIds: brief.angle.hookFactIds,
          confidence: confidence.value,
          confidenceDetail: confidence.explanation,
        }
      : null,
  });
}
