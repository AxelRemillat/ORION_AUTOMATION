import { z } from "zod";
import { getOpenAI } from "@/lib/openai";
import { AiCallError, chatJson, type AskFn } from "@/lib/ai/chat";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { fetchQuota, findDecisionMaker, findEmailByName, hasHunterKey } from "@/lib/enrichment/hunter";
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
  type StrategyBrief,
} from "@/lib/emails/strategist";
import { describesNeed, needConfidence } from "@/lib/emails/need-lead";
import { edges, maxSimilarity } from "@/lib/similarity";
import { coerceTone } from "@/lib/tones";
import { activeProspects } from "@/lib/trash/scope";
import { loadOffer } from "@/lib/offer/read";
import type { Prospect } from "@/types";
import { draftFromBrief } from "@/app/api/emails/generate/pipeline";
import type { Evidence } from "@/app/api/emails/generate/prompt";
import { JobError, type JobHandler, type StepContext, type StepOutcome } from "../runner";

/**
 * Génération d'un mail, en trois étapes reprenables :
 *
 *   1. contact  — Hunter (mode `full` seulement), vérifications du prospect ;
 *   2. brief    — le stratège (ou le brief édité, revalidé) ;
 *   3. draft    — rédacteur + juge + une réécriture, puis brouillon en base.
 *
 * Chaque étape range son résultat dans `state` : une reprise ne rappelle ni
 * Hunter ni le stratège une seconde fois.
 */

const SIMILARITY_LIMIT = 0.4;
const HISTORY = 10;

const CONTACT_SCHEMA = z.object({
  email: z.string(),
  full_name: z.string().nullable(),
  position: z.string().nullable(),
  confidence: z.number().nullable(),
});

const ANGLE_SCHEMA = BRIEF_SCHEMA.shape.angle;

export const EMAIL_PARAMS_SCHEMA = z.object({
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
  /**
   * Enregistre le brouillon dans `messages` (→ `result.messageId`). L'écran
   * Prospection actuel l'enregistre lui-même à la validation : il passe
   * `false` pour ne pas créer de doublon.
   */
  saveDraft: z.boolean().default(true),
});
export type EmailParams = z.infer<typeof EMAIL_PARAMS_SCHEMA>;

function paramsOf(ctx: StepContext): EmailParams {
  const parsed = EMAIL_PARAMS_SCHEMA.safeParse(ctx.job.params);
  if (!parsed.success) throw new JobError("Requête invalide.", false, 400);
  // `email_rewrite` n'a qu'un sens : rédacteur seul depuis le brief.
  return ctx.job.type === "email_rewrite" ? { ...parsed.data, mode: "rewrite" } : parsed.data;
}

/** Prospect vivant de CET utilisateur (client service_role : filtre explicite). */
async function loadProspect(ctx: StepContext, id: string): Promise<Prospect> {
  const { data, error } = await activeProspects(ctx.db).eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (error) throw new Error(`lecture du prospect impossible : ${error.message}`);
  if (!data) throw new JobError("Prospect introuvable.", false, 404);
  return data as Prospect;
}

/**
 * Recherche du contact nominatif — au moment du brouillon, jamais avant.
 * L'absence de contact est un résultat acceptable (« Bonjour, »).
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
  const leaderPerson = typeof figures.leader_person === "string" ? figures.leader_person : null;
  const leader = typeof figures.leader === "string" ? figures.leader : null;

  // 1. Un décideur sur le domaine.
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

  // 3. Rien : on le dit, et on écrit « Bonjour, ».
  return { contact: null, warning: { source: "hunter", message: "aucun contact nominatif trouve sur ce domaine" } };
}

function storedAngle(prospect: Prospect): BriefAngle | null {
  const parsed = ANGLE_SCHEMA.safeParse((prospect.brief as { angle?: unknown } | null | undefined)?.angle);
  return parsed.success ? parsed.data : null;
}

function askFor(prospectId: string): AskFn {
  return (role, system, user, temperature, operation) =>
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
          prospectId,
        }),
    });
}

/** Un paramètre refusé par le modèle ne se corrige pas en réessayant. */
async function guardAi<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AiCallError) throw new JobError(error.message, false, 502);
    throw error;
  }
}

const warningsOf = (ctx: StepContext) => (ctx.job.state.warnings as EnrichmentWarning[] | undefined) ?? [];
const contactOf = (ctx: StepContext) => (ctx.job.state.contact as DecisionMakerContact | null | undefined) ?? null;

const progress = (step: string, pct: number) => ({ step, pct, counts: { scanned: 0, signals: 0, sheets: 0 } });

/** Vérifications partagées par la route et le job. Rend l'erreur, ou null. */
export function emailBlocker(prospect: Prospect): { message: string; status: number } | null {
  // Un prospect perdu est clos : générer, c'est relancer quelqu'un qui a dit non.
  if (prospect.status === "perdu") {
    return {
      message: "Prospect clôturé : ce prospect est marqué « Perdu », la génération est désactivée.",
      status: 409,
    };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { message: "OPENAI_API_KEY absente : la génération est indisponible.", status: 503 };
  }
  return null;
}

async function contactStep(ctx: StepContext): Promise<StepOutcome> {
  const params = paramsOf(ctx);
  const prospect = await loadProspect(ctx, params.prospectId);
  const blocker = emailBlocker(prospect);
  if (blocker) throw new JobError(blocker.message, false, blocker.status);

  const warnings: EnrichmentWarning[] = [];
  let contact: DecisionMakerContact | null;
  if (params.mode === "full") {
    const outcome = await findContact(prospect).catch(() => ({ contact: null, warning: undefined }));
    contact = outcome.contact;
    if (outcome.warning) warnings.push(outcome.warning);
  } else {
    // Hors génération complète, AUCUN appel Hunter : le contact revient du client.
    contact = (params.cachedContact as DecisionMakerContact | null | undefined) ?? null;
  }
  return {
    state: { contact, warnings },
    result: { prospectIds: [prospect.id] },
    progress: progress(params.mode === "rewrite" ? "Relecture du brief" : "Stratégie de l'angle", 20),
  };
}

async function briefStep(ctx: StepContext): Promise<StepOutcome> {
  const params = paramsOf(ctx);
  const prospect = await loadProspect(ctx, params.prospectId);
  const warnings = [...warningsOf(ctx)];
  const factsResult = buildFacts(prospect, contactOf(ctx));
  for (const rejected of factsResult.rejectedSignals.filter((item) => item.reason === "homonyme probable")) {
    warnings.push({ source: "linkup", message: `signal écarté, homonyme probable : ${rejected.entity ?? rejected.label}` });
  }

  const { data: sent } = await ctx.db
    .from("messages")
    .select("subject, body, sent_at")
    .eq("prospect_id", prospect.id)
    .eq("user_id", ctx.userId)
    .eq("status", "sent")
    .order("created_at", { ascending: true });

  const figures = prospect.key_figures ?? {};
  const excludeAngles = [...(params.excludeAngles ?? [])];
  const previous = storedAngle(prospect);
  if (params.mode === "other_angle" && previous) excludeAngles.push(previous);

  const input: StrategistInput = {
    facts: factsResult.facts,
    companyName: factsResult.companyName,
    isLargeGroupSubsidiary: factsResult.isLargeGroupSubsidiary,
    parentGroup: (typeof figures.parent_group === "string" ? figures.parent_group : null) ?? factsResult.parent,
    foreignEntities: factsResult.foreignEntities,
    history: (sent ?? []) as HistoryMessage[],
    excludeAngles: params.mode === "full" ? [] : excludeAngles,
    sector: prospect.sector,
  };

  let outcome: BriefOutcome;
  if (params.mode === "rewrite") {
    // Brief édité à la main : revalidé comme une sortie du modèle.
    outcome = validateBrief(params.brief, { ...input, excludeAngles: [] });
    if (outcome.brief) outcome.brief.excludedAngles = excludeAngles;
    if (!outcome.brief) throw new JobError(`Brief inexploitable : ${outcome.error}`, false, 502);
  } else {
    const ask = askFor(prospect.id);
    outcome = await guardAi(() =>
      runStrategist((system, user, operation) => ask("strategist", system, user, 0.2, operation), input),
    );
    // Sortie du modèle invalide : une nouvelle tentative a ses chances.
    if (!outcome.brief) throw new JobError(`Brief inexploitable : ${outcome.error}`, true, 502);
  }

  // Stocké avec le prospect : « Autre angle » s'en sert pour exclure l'angle.
  const saved = await ctx.db.from("prospects").update({ brief: outcome.brief }).eq("id", prospect.id);
  if (saved.error) {
    warnings.push({ source: "openai", message: "brief non enregistré : appliquez la migration 20260925100000_prospect_brief.sql" });
  }
  return { state: { brief: outcome.brief, warnings }, progress: progress("Rédaction du mail", 50) };
}

async function draftStep(ctx: StepContext): Promise<StepOutcome> {
  const params = paramsOf(ctx);
  const prospect = await loadProspect(ctx, params.prospectId);
  const brief = ctx.job.state.brief as StrategyBrief | undefined;
  if (!brief) throw new JobError("brief manquant : l'étape précédente n'a pas abouti", false, 500);
  const contact = contactOf(ctx);
  const warnings = [...warningsOf(ctx)];
  const loaded = await loadOffer(ctx.db, ctx.userId);
  const factsResult = buildFacts(prospect, contact);
  const { facts, leaderPerson } = factsResult;

  // Anti-répétition : on interdit les ouvertures déjà servies, puis on MESURE.
  const { data: recent } = await ctx.db
    .from("messages")
    .select("body")
    .eq("user_id", ctx.userId)
    .eq("type", "intro")
    .order("created_at", { ascending: false })
    .limit(HISTORY);
  const previousBodies = (recent ?? []).map((row) => (row as { body: string }).body);
  const avoid = previousBodies.flatMap((text) => {
    const { opening, closing } = edges(text);
    return [opening, closing].filter(Boolean);
  });

  const draft = await guardAi(() =>
    draftFromBrief({
      offer: loaded.offer,
      ask: askFor(prospect.id),
      brief,
      facts,
      tone: coerceTone(params.tone),
      contact,
      prospectId: prospect.id,
      registryName: prospect.company_name,
      avoid,
      leaderPerson,
      forbiddenNames: factsResult.foreignEntities,
      judge: params.mode !== "rewrite",
    }),
  );
  if ("error" in draft) throw new JobError(draft.error, true, 502);
  const { email, validation, critique, failing } = draft;

  const similarity = maxSimilarity(email.body, previousBodies);
  if (similarity > SIMILARITY_LIMIT) {
    warnings.push({ source: "openai", message: `Ce brouillon ressemble à ${Math.round(similarity * 100)} % à un mail déjà envoyé.` });
  }
  if (contact && !prospect.email && params.mode === "full") {
    await ctx.db.from("prospects").update({ email: contact.email }).eq("id", prospect.id);
  }

  const figures = prospect.key_figures ?? {};
  const confidence = needConfidence({
    facts,
    hasSiteContent: figures.site_status === "lu",
    vocabularyConfirmed: Array.isArray(figures.site_vocabulary) && figures.site_vocabulary.length > 0,
  });
  const evidence: Evidence[] = facts.map((fact) => ({
    label: fact.label,
    value: fact.value,
    source: fact.source,
    ...(fact.url ? { url: fact.url } : {}),
  }));
  const leadText = brief.angle.insight;

  let messageId: string | undefined;
  if (params.saveDraft) {
    // Écrit en dernier, juste avant le commit de l'étape : seule une coupure
    // entre les deux laisserait un brouillon en double (jamais un mail envoyé).
    const existing = ctx.job.result.messageId;
    if (existing) messageId = existing;
    else {
      const { data, error } = await ctx.db
        .from("messages")
        .insert({
          prospect_id: prospect.id,
          user_id: ctx.userId,
          type: "intro",
          subject: email.subject.trim() || null,
          body: email.body.trim(),
          status: "draft",
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`brouillon non enregistré : ${error?.message ?? "inconnue"}`);
      messageId = data.id;
    }
  }

  const response = {
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
  };

  return {
    state: { response },
    result: { prospectIds: [prospect.id], ...(messageId ? { messageId } : {}) },
    progress: progress("Brouillon prêt", 100),
  };
}

export const emailHandler: JobHandler = { steps: [contactStep, briefStep, draftStep] };
