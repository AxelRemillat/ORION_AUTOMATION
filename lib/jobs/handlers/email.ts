import { z } from "zod";
import { getOpenAI } from "@/lib/openai";
import { AiCallError, chatJson, type AskFn } from "@/lib/ai/chat";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { fetchQuota, findDecisionMaker, findEmailByName, hasHunterKey } from "@/lib/enrichment/hunter";
import { toDomain } from "@/lib/enrichment/http";
import type { DecisionMakerContact, EnrichmentWarning } from "@/lib/enrichment/types";
import { buildFacts } from "@/lib/emails/derived-facts";
import { hookReadiness } from "@/lib/emails/hook-readiness";
import { incomingLeader, leaderEmailQuery } from "@/lib/emails/incoming-leader";
import { dateUndatedSignals } from "@/lib/signals/dating";
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
  /**
   * Brouillon déjà en base pour ce prospect (génération précédente) : il est
   * RÉÉCRIT au lieu d'en créer un second, tant qu'il n'est pas parti.
   */
  replaceMessageId: z.string().min(1).nullish(),
  /**
   * « Générer quand même » : passe outre l'absence d'accroche forte.
   *
   * Le brouillon produit est marqué « générique » — il reste utile comme base,
   * mais on sait pourquoi il est faible.
   */
  force: z.boolean().optional(),
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
export async function findContact(
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
  const known = leaderPerson ?? leader;

  /*
   * L'ordre, et POURQUOI cet ordre.
   *
   * Constate le 27/09/2026 sur SELECTION HABITAT : Hunter rend dix contacts
   * nominatifs sur le domaine — dont « Business Development Director » a 97 % —
   * et l'ecran affichait « aucun decideur trouve ». Deux raisons, cumulees :
   * la liste blanche des postes ne reconnaissait aucun de ces intitules, et
   * l'`email-finder` etait appele avec « Louis Alain Vilain » comme nom de
   * famille (tout sauf le premier mot), donc ne trouvait rien.
   *
   * Desormais : le dirigeant du registre est TOUJOURS cherche — recherche de
   * domaine, puis email-finder sur prenom + nom, meme si la premiere a echoue —
   * et faute de decideur on se rabat sur le meilleur contact nominatif reel.
   * Ecrire a une personne dont on connait le nom, quitte a ce qu'elle
   * transmette, vaut mieux que « Bonjour, » a personne.
   */

  // 0. Un dirigeant qui vient d'arriver passe devant tout le reste : c'est a
  // lui qu'on ecrit, et c'est son arrivee qui porte l'accroche.
  const newLeader = incomingLeader(figures);
  const query = newLeader ? leaderEmailQuery(newLeader, prospect.website) : null;
  if (query) {
    const named = await findEmailByName(query.domain, query.firstName, query.lastName, prospect.id);
    if (named.ok && named.data) return { contact: named.data };
  }

  // 1. Recherche de domaine : un decideur, et la liste des personnes trouvees.
  const search = await findDecisionMaker(domain, known, prospect.id);
  if (search.ok && search.data.contact) return { contact: search.data.contact };

  if (!search.ok && search.quotaExceeded) {
    const quota = await fetchQuota();
    const detail = quota
      ? `quota atteint (${quota.used}/${quota.available} recherches du plan ${quota.planName ?? "en cours"})`
      : "quota de recherches atteint pour ce mois";
    return { contact: null, warning: { source: "hunter", message: detail } };
  }

  // 2. Le dirigeant connu, par son PRENOM et son NOM — jamais « tout sauf le
  // premier mot » : « Jean-Stephane Louis Alain Vilain » se cherche a
  // « Jean-Stephane » + « Vilain ». Tente meme quand l'etape 1 a echoue.
  const parts = (known ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const finder = await findEmailByName(domain, parts[0], parts[parts.length - 1], prospect.id);
    if (finder.ok && finder.data) return { contact: finder.data };
    if (!finder.ok && finder.quotaExceeded) {
      return { contact: null, warning: { source: "hunter", message: "quota de recherches atteint pour ce mois" } };
    }
  }

  // 3. Repli : le meilleur contact nominatif du domaine, sans second appel.
  const fallback = search.ok ? search.data.candidates[0] : null;
  if (fallback) {
    return {
      contact: fallback,
      warning: {
        source: "hunter",
        message:
          `aucun dirigeant sur ce domaine : contact retenu ${fallback.full_name ?? fallback.email}` +
          `${fallback.position ? ` (${fallback.position})` : ""}`,
      },
    };
  }

  // 4. Rien : on le dit, et on ecrit « Bonjour, ».
  const reason = search.ok ? "aucun contact nominatif trouve sur ce domaine" : search.error;
  return { contact: null, warning: { source: "hunter", message: reason } };
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

/**
 * Jalons de la barre de /prospection : analyse → stratège → rédaction → juge.
 * L'écran lit le pourcentage ; le libellé est déjà rédigé pour lui.
 */
export const EMAIL_STAGES = {
  analyse: progress("Analyse de la fiche", 5),
  strategist: progress("Stratège : choix de l'angle", 25),
  writer: progress("Rédaction du mail", 50),
  judge: progress("Juge : relecture critique", 75),
  rewrite: progress("Réécriture après le juge", 85),
  done: progress("Brouillon prêt", 100),
} as const;

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
  await ctx.progress(EMAIL_STAGES.analyse).catch(() => undefined);

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
    progress: params.mode === "rewrite" ? { ...EMAIL_STAGES.strategist, step: "Relecture du brief" } : EMAIL_STAGES.strategist,
  };
}

async function briefStep(ctx: StepContext): Promise<StepOutcome> {
  const params = paramsOf(ctx);
  const prospect = await loadProspect(ctx, params.prospectId);
  const warnings = [...warningsOf(ctx)];
  let factsResult = buildFacts(prospect, contactOf(ctx));

  // --- DERNIÈRE CHANCE DONNÉE AUX SIGNAUX SANS DATE -----------------------
  //
  // Un signal fort mais non daté valait mieux qu'un mail ouvert sur le code
  // NAF, et il suffisait parfois d'un aller-retour pour le sauver : la page
  // porte souvent sa date en JSON-LD, et le registre date les ouvertures
  // d'établissement. On ne paie ces allers-retours que si la fiche n'a AUCUNE
  // accroche — donc jamais en routine.
  if (params.mode === "full" && !hookReadiness(factsResult.facts).ready) {
    const dated = await dateUndatedSignals(prospect.signals ?? [], {
      siren: prospect.siren,
      city: prospect.city,
    }).catch(() => ({ signals: prospect.signals ?? [], changed: false }));

    if (dated.changed) {
      prospect.signals = dated.signals;
      await ctx.db.from("prospects").update({ signals: dated.signals }).eq("id", prospect.id);
      factsResult = buildFacts(prospect, contactOf(ctx));
    }
  }

  // --- GATING : pas de brouillon sans accroche forte ----------------------
  //
  // Sans signal daté ni fait de site, le stratège retombe sur l'angle
  // « métier » et le rédacteur sur le code NAF ou l'effectif. Le juge note
  // alors la spécificité 1 ou 2 sur 5, à raison. Trois appels de modèle pour
  // un mail qu'on n'enverra pas : autant le dire.
  const readiness = hookReadiness(factsResult.facts);
  if (!readiness.ready && !params.force) {
    throw new JobError(readiness.reason, false, 409, { needsFeeding: true, canForce: true });
  }

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
  return { state: { brief: outcome.brief, warnings }, progress: EMAIL_STAGES.writer };
}

/** Le brouillon précédent n'est réécrit que s'il est à nous, à ce prospect, et pas parti. */
async function replaceableDraft(
  ctx: StepContext,
  prospectId: string,
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;
  const { data } = await ctx.db
    .from("messages")
    .select("id")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("prospect_id", prospectId)
    .eq("status", "draft")
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
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
      // Un dirigeant qui vient d'arriver est interpellé par son prénom : c'est
      // à lui que le mail parle, et son arrivée est l'accroche.
      addressee: incomingLeader(prospect.key_figures ?? {})?.fullName ?? null,
      // Le secteur oriente la preuve : interim, RH et formation ne passent pas
      // de commandes, ils traitent des dossiers.
      sector: prospect.sector,
      forbiddenNames: factsResult.foreignEntities,
      judge: params.mode !== "rewrite",
      onStage: (stage) => ctx.progress(EMAIL_STAGES[stage]),
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
    const existing = ctx.job.result.messageId ?? (await replaceableDraft(ctx, prospect.id, params.replaceMessageId));
    if (existing) {
      const { error } = await ctx.db
        .from("messages")
        .update({ subject: email.subject.trim() || null, body: email.body.trim() })
        .eq("id", existing)
        .eq("status", "draft");
      if (error) throw new Error(`brouillon non enregistré : ${error.message}`);
      messageId = existing;
    } else {
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
    /**
     * Brouillon produit malgré l'absence d'accroche forte (« Générer quand
     * même »). Il reste utile comme base, mais il ne doit jamais partir tel
     * quel sans qu'on sache pourquoi il est faible.
     */
    generic: !hookReadiness(facts).ready,
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
    progress: EMAIL_STAGES.done,
  };
}

export const emailHandler: JobHandler = { steps: [contactStep, briefStep, draftStep] };
