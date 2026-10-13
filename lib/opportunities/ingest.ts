import { TITLE_ONLY, TITLE_ONLY_NOTE } from "./title-only";
import type { AskFn } from "@/lib/ai/chat";
import { quotaHitSince } from "@/lib/ai/quota";
import type { Notification } from "@/lib/notify/ntfy";
import { coreSignals } from "./core-signal";
import { analyzeOpportunity, type Analysis } from "./analyze";
import { prefilterReason, titleOnlyReason } from "./prefilter";
import { generateProposal } from "./proposal";
import { CMS_NOTE, generateLaunchProposal, laneOf, type Lane } from "./launch";
import { REGIE_BADGE } from "./lane";
import { isPlatform, proposalLanguage, type Platform } from "./types";

/**
 * VEILLE CODEUR AUTOMATIQUE — un item du flux RSS officiel, poussé par le
 * workflow n8n dédié (un à la fois, toutes les 5 minutes).
 *
 *   doublon ? → { duplicate: true }, aucun appel LLM
 *   pré-filtre gratuit → « Ignorée » avec le motif (gardée pour audit)
 *   plafond quotidien d'analyses atteint → « À analyser », sans LLM
 *   sinon analyse d'adéquation (0–10, 3 raisons, démo) sous échéance ;
 *   proposition seulement si score ≥ 7, en arrière-plan (l'alerte part vite).
 *
 * MISSION DE LANCEMENT (Codeur, 11/10/2026) : développement web sans CMS imposé,
 * budget ≤ 1 000 € ou non indiqué → verdict « alerte » quel que soit le score (même
 * sans analyse), proposition de lancement à prix fixe. CMS IMPOSÉ → « À voir », jamais
 * d'alerte, jamais « Ignorée » par l'analyse.
 *
 * CRÉDIT OPENAI ÉPUISÉ (Cowork #35) : l'offre est enregistrée « Non analysée »
 * (jamais « Ignorée ») ; un signal fort du cœur de cible (IA, automatisation,
 * n8n, API…) envoie quand même une notification. Dès qu'une analyse repasse,
 * les « Non analysées » de moins de 48 h sont rattrapées en arrière-plan.
 *
 * Rien n'est lu sur les pages Codeur : le flux ne donne qu'un EXTRAIT, et la
 * proposition faite dessus est un « brouillon sur extrait ».
 */

export const ALERT_SCORE = 8;
export const PROPOSAL_SCORE = 7;
export const TO_REVIEW_SCORE = 5;
export const DEFAULT_DAILY_LLM_CAP = 60;

/**
 * FRAÎCHEUR (Cowork, 06/10/2026) : une annonce publiée il y a plus de 7 jours
 * a peu de chances d'aboutir (des dizaines d'offres déjà reçues) — jamais
 * d'alerte : score plafonné à 6 (« à voir »).
 */
export const STALE_AFTER_DAYS = 7;
export const STALE_MAX_SCORE = 6;

/** Âge de l'annonce en jours (publication sur la plateforme), `null` si inconnue. */
export function adAgeDays(publishedAt: string | null | undefined, now = new Date()): number | null {
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) return null;
  return Math.floor((now.getTime() - Date.parse(publishedAt)) / 86_400_000);
}

/** Score retenu : plafonné à 6 pour une annonce ancienne. */
export function freshScore(score: number, publishedAt: string | null | undefined, now = new Date()): number {
  const age = adAgeDays(publishedAt, now);
  return age !== null && age > STALE_AFTER_DAYS ? Math.min(score, STALE_MAX_SCORE) : score;
}

/**
 * Statut après (ré)analyse : sous 5 → « Ignorée » ; à 5 ou plus, une fiche
 * « Ignorée » (filtre ou ancienne analyse) revient en « À répondre ». Les
 * autres statuts (envoyée, réponse…) ne bougent jamais.
 */
export function statusAfterAnalysis(current: string | null | undefined, score: number): "ignoree" | "a_repondre" | null {
  if (score < TO_REVIEW_SCORE) return current === "a_repondre" || current == null ? "ignoree" : null;
  return current === "ignoree" ? "a_repondre" : null;
}
/** Le workflow attend la réponse : au-delà, on répond « en cours » et on finit en arrière-plan. */
export const INGEST_DEADLINE_MS = 20_000;

export interface IngestBody {
  platform: Platform;
  external_id: string;
  url: string | null;
  title: string;
  description: string;
  description_truncated: boolean;
  budget_text: string | null;
  categories: string[];
  published_at: string | null;
  /** Origine : flux RSS Codeur (défaut) ou e-mail de plateforme (/ingest-email). */
  source?: "rss" | "email";
  /**
   * Annonce réduite à son TITRE (alerte e-mail Codeur, plateformes #11) : pré-filtre sur
   * le titre seul, puis « À voir » SANS analyse — un score sur un titre ne veut rien dire.
   */
  titleOnly?: boolean;
}

export { TITLE_ONLY, TITLE_ONLY_NOTE };

export type Verdict = "alerte" | "a_voir" | "ignore";

export interface IngestResponse {
  id: string;
  score: number | null;
  verdict: Verdict;
  reasons: string[];
  title: string;
  url: string | null;
  orion_url: string;
  duplicate?: true;
  pending?: true;
  filtered?: true;
  /** Analyse impossible (crédit OpenAI épuisé) : « Non analysée ». */
  not_analyzed?: true;
  /** Annonce réduite au titre : « À voir », sans analyse (plateformes #11). */
  title_only?: true;
  /** Catégorie Codeur (11/10/2026) : « lancement » (alerte) ou « cms_impose » (à voir). */
  lane?: Lane;
}

/** Raison affichée en tête (notification, fiche) pour une catégorie Codeur. */
export const LANE_REASONS: Record<Lane, string> = {
  lancement: "Mission de lancement : développement web, petit budget — répondre parmi les premiers",
  cms_impose: CMS_NOTE,
  regie: `${REGIE_BADGE} — mission en régie sur votre stack (Next.js, React, Node, IA) : à vous de juger selon l'alternance`,
};

/** Verdict d'une fiche selon sa catégorie : lancement ou régie → alerte ; CMS imposé (ancien) → à voir ; sinon le score. */
export function laneVerdict(lane: Lane | null, score: number | null): Verdict {
  if (lane === "lancement" || lane === "regie") return "alerte";
  if (lane === "cms_impose") return "a_voir";
  return verdictOf(score);
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export function parseIngestBody(raw: Record<string, unknown> | null): { ok: true; value: IngestBody } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: "Corps JSON attendu." };
  const platform = isPlatform(raw.platform) ? raw.platform : null;
  if (!platform) return { ok: false, error: "platform inconnue." };
  const externalId = text(raw.external_id === undefined ? "" : String(raw.external_id), 120);
  const title = text(raw.title, 300);
  if (!externalId || !title) return { ok: false, error: "external_id et title sont obligatoires." };
  const url = text(raw.url, 1000);
  const published = text(raw.published_at, 40);
  return {
    ok: true,
    value: {
      platform,
      external_id: externalId,
      url: /^https?:\/\//i.test(url) ? url : null,
      title,
      description: text(raw.description, 20_000),
      description_truncated: raw.description_truncated === true || /…\s*$|\.\.\.\s*$/.test(text(raw.description, 20_000)),
      budget_text: text(raw.budget_text, 120) || null,
      categories: Array.isArray(raw.categories) ? raw.categories.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 30) : [],
      published_at: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
    },
  };
}

export const verdictOf = (score: number | null): Verdict => (score === null ? "a_voir" : score >= ALERT_SCORE ? "alerte" : score >= TO_REVIEW_SCORE ? "a_voir" : "ignore");

type Db = { from: (table: string) => any };

export interface IngestDeps {
  db: Db;
  userId: string;
  ask: AskFn;
  /** URL de base d'ORION (lien de la notification). */
  baseUrl: string;
  llmCap?: number;
  now?: () => Date;
  deadlineMs?: number;
  /** Fait vivre une promesse après la réponse (waitUntil sur Vercel). */
  background?: (work: Promise<unknown>) => void;
  /** Notification téléphone (ntfy) — « analyse indisponible » sur signal fort. */
  notify?: (notification: Notification) => Promise<unknown>;
  /** Offre passée en Alerte, une seule fois (notification PC, Cowork #28). Ne doit pas lever. */
  onAlert?: (id: string) => Promise<unknown>;
}

/** Statut d'analyse d'une offre que le crédit OpenAI épuisé n'a pas permis d'analyser. */
export const NOT_ANALYZED = "non_analysee";
/** Rattrapage automatique : les « Non analysées » de moins de 48 h, 5 par ingestion. */
export const CATCH_UP_HOURS = 48;
const CATCH_UP_BATCH = 5;

/** Texte vu par l'analyse : titre, extrait et catégories (le flux n'a rien de plus). */
const analysisBody = (body: IngestBody) => [body.description, body.categories.length ? `Catégories : ${body.categories.join(" ; ")}` : ""].filter(Boolean).join("\n\n");

const orionUrl = (baseUrl: string, id: string) => `${baseUrl.replace(/\/$/, "")}/opportunites?id=${encodeURIComponent(id)}`;

/** Analyse puis écriture ; renvoie l'analyse (ou null si indisponible). */
async function analyzeRow(deps: IngestDeps, id: string, body: IngestBody, lane: Lane | null = null): Promise<Analysis | null> {
  const started = Date.now();
  const analysis = await analyzeOpportunity(deps.ask, { title: body.title, body: analysisBody(body), budget: body.budget_text, platform: body.platform });
  const clock = (deps.now ?? (() => new Date()))();
  if (analysis) analysis.score = freshScore(analysis.score, body.published_at, clock);
  const now = clock.toISOString();
  await deps.db
    .from("opportunities")
    .update(
      analysis
        ? {
            fit_score: analysis.score,
            fit_reasons: analysis.reasons,
            need: analysis.need,
            demo: analysis.demo,
            language: analysis.language,
            analyzed_at: now,
            analysis_state: "ok",
            updated_at: now,
          }
        : // Analyse impossible (crédit épuisé, budget de l'app, erreur API, réponse illisible) :
          // « Non analysée » (rattrapée dès qu'une analyse repasse), jamais « Ignorée ». « À analyser »
          // reste réservé au plafond quotidien (plateformes #10).
          { analysis_state: NOT_ANALYZED, updated_at: now },
    )
    .eq("id", id);
  // Sous 5 : rangée avec les ignorées (Axel peut toujours la rouvrir) — seulement si elle est encore
  // « À répondre » : une commande ou un message reçu par e-mail a déjà fait avancer son statut.
  // Mission de lancement et CMS imposé : jamais « Ignorée » par l'analyse (11/10/2026).
  const status = analysis && !lane ? statusAfterAnalysis("a_repondre", analysis.score) : null;
  if (status) await deps.db.from("opportunities").update({ status, updated_at: now }).eq("id", id).eq("status", "a_repondre");
  if (!analysis && quotaHitSince(started)) await alertWithoutAnalysis(deps, id, body);
  return analysis;
}

/**
 * ALERTE ENVOYÉE PAR ORION (Cowork #27). n8n ne notifie que sur la réponse synchrone de
 * l'ingestion : une analyse finie APRÈS la réponse (échéance de 20 s dépassée), ou faite par
 * un rattrapage, n'était jamais notifiée — une offre à 9/10 se perdait en silence. ORION
 * notifie donc lui-même dans ces cas-là, une seule fois par offre (`notification_log`).
 */
/**
 * Trace « cette offre a déjà été signalée en alerte » (n8n prévenu, ou notification d'ORION).
 * `true` si la trace vient d'être posée, `false` si elle existait déjà (clé unique en base).
 * C'est un FAIT enregistré : rejouer les règles d'aujourd'hui sur une vieille fiche dirait
 * à tort qu'elle avait alerté.
 */
export async function markAlerted(deps: Pick<IngestDeps, "db" | "userId" | "onAlert" | "background">, id: string): Promise<boolean> {
  const { error } = await deps.db.from("notification_log").insert({ key: `opportunite:${id}`, user_id: deps.userId, kind: "opportunite" });
  if (error) return false;
  // Première trace = l'offre vient de passer en Alerte : notification PC (Cowork #28), sans retarder la réponse.
  if (deps.onAlert) {
    const work = deps.onAlert(id).catch(() => undefined);
    if (deps.background) deps.background(work);
    else await work;
  }
  return true;
}

export async function notifyLateAlert(deps: IngestDeps, id: string, body: IngestBody, analysis: Analysis | null, lane: Lane | null): Promise<boolean> {
  if (!deps.notify || laneVerdict(lane, analysis?.score ?? null) !== "alerte") return false;
  if (!(await markAlerted(deps, id))) return false; // déjà signalée : pas de doublon
  const reasons = [...(lane ? [LANE_REASONS[lane]] : []), ...(analysis?.reasons ?? [])].slice(0, 2);
  await deps
    .notify({
      title: `${analysis ? `${analysis.score}/10 · ` : ""}${body.title}`,
      body: `${reasons.join(" · ")}${body.budget_text ? ` · Budget : ${body.budget_text}` : ""}`,
      priority: "high",
      tags: ["briefcase"],
      click: orionUrl(deps.baseUrl, id),
    })
    .catch(() => undefined);
  return true;
}

/** Analyse impossible : alerte quand même si l'offre touche le cœur de cible. */
async function alertWithoutAnalysis(deps: IngestDeps, id: string, body: IngestBody): Promise<void> {
  const signals = coreSignals({ title: body.title, description: body.description, categories: body.categories });
  if (!signals.length || !deps.notify) return;
  await deps
    .notify({
      title: `Nouvelle offre (analyse indisponible) : ${body.title}`,
      body: `Signal fort : ${signals.join(", ")}. Crédit OpenAI épuisé, l'analyse se fera à la recharge.${body.budget_text ? ` Budget : ${body.budget_text}.` : ""}`,
      priority: "high",
      tags: ["briefcase"],
      click: orionUrl(deps.baseUrl, id),
    })
    .catch(() => undefined);
}

/**
 * Rattrapage : les offres « Non analysées » de moins de 48 h, analysées dès
 * qu'une analyse repasse (crédit revenu). Les plus anciennes restent sur le
 * bouton « Analyser ».
 */
export async function catchUpUnanalyzed(deps: IngestDeps): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - CATCH_UP_HOURS * 3_600_000).toISOString();
  const { data } = await deps.db
    .from("opportunities")
    .select("id, platform, title, body, budget, categories, published_at, description_truncated, url, external_id")
    .eq("user_id", deps.userId)
    // « À analyser » (plafond quotidien atteint) aussi : une annonce n'est jamais perdue (Cowork #27).
    .in("analysis_state", [NOT_ANALYZED, "a_analyser"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(CATCH_UP_BATCH);
  let done = 0;
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const body: IngestBody = {
      platform: row.platform as Platform,
      external_id: String(row.external_id ?? ""),
      url: (row.url as string | null) ?? null,
      title: String(row.title ?? ""),
      description: String(row.body ?? ""),
      description_truncated: row.description_truncated === true,
      budget_text: (row.budget as string | null) ?? null,
      categories: Array.isArray(row.categories) ? (row.categories as string[]) : [],
      published_at: (row.published_at as string | null) ?? null,
    };
    const lane = laneOf({ platform: body.platform, title: body.title, description: body.description, categories: body.categories, budget: body.budget_text, published_at: body.published_at }, now);
    const analysis = await analyzeRow(deps, String(row.id), body, lane);
    if (!analysis) break; // toujours indisponible : on s'arrête là
    done += 1;
    if (lane === "lancement" || analysis.score >= PROPOSAL_SCORE) await proposeRow(deps, String(row.id), body, analysis, lane).catch(() => undefined);
    await notifyLateAlert(deps, String(row.id), body, analysis, lane);
  }
  return done;
}

/** Proposition (score ≥ 7, ou mission de lancement) : brouillon sur extrait, une réécriture au plus (coût ≤ ~0,01 €). */
async function proposeRow(deps: IngestDeps, id: string, body: IngestBody, analysis: Analysis | null, lane: Lane | null = null): Promise<void> {
  const launch = lane === "lancement";
  const proposal = launch
    ? await generateLaunchProposal({ ask: deps.ask, title: body.title, body: analysisBody(body) || body.title, budget: body.budget_text, need: analysis?.need ?? null })
    : analysis
      ? await generateProposal({
          ask: deps.ask,
          platform: body.platform,
          language: proposalLanguage(body.platform, analysis.language),
          title: body.title,
          body: analysisBody(body),
          budget: body.budget_text,
          need: analysis.need,
          demo: analysis.demo,
          kind: analysis.kind,
          maxRewrites: 1,
        })
      : { error: "aucune analyse" };
  if ("error" in proposal) return;
  await deps.db
    .from("opportunities")
    .update({
      proposal: proposal.text,
      proposal_score: proposal.score,
      proposal_reason: proposal.needsReview ? proposal.reason : null,
      proposal_on_excerpt: body.description_truncated,
      suggested_amount_eur: proposal.amountEur,
      suggested_delay_days: proposal.delayDays,
      suggested_currency: proposal.currency,
      suggested_hourly: proposal.hourly,
      updated_at: (deps.now ?? (() => new Date()))().toISOString(),
    })
    .eq("id", id);
}

/**
 * RATTRAPAGE (plateformes #10) : ré-analyse d'une fiche existante par le MÊME code
 * que l'ingestion (analyse, fraîcheur, statut, proposition si score ≥ 7). Aucune
 * alerte ici : l'appelant décide (même seuil que la veille, verdict « alerte »).
 */
export async function reanalyzeOpportunity(deps: IngestDeps, id: string, body: IngestBody): Promise<Analysis | null> {
  const lane = laneOf({ platform: body.platform, title: body.title, description: body.description, categories: body.categories, budget: body.budget_text, published_at: body.published_at }, (deps.now ?? (() => new Date()))());
  const analysis = await analyzeRow(deps, id, body, lane);
  if (lane === "lancement" || (analysis && analysis.score >= PROPOSAL_SCORE)) await proposeRow(deps, id, body, analysis, lane).catch(() => undefined);
  return analysis;
}

export async function ingestOpportunity(deps: IngestDeps, body: IngestBody): Promise<IngestResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const base = { title: body.title, url: body.url };

  // 1. Idempotence : une annonce = une ligne, jamais deux analyses.
  const { data: known } = await deps.db
    .from("opportunities")
    .select("id, fit_score, fit_reasons, filter_reason, analysis_state, status, title")
    .eq("user_id", deps.userId)
    .eq("platform", body.platform)
    .eq("external_id", body.external_id)
    .limit(1);
  const existing = (known ?? [])[0] as { id: string; fit_score: number | null; fit_reasons: string[] | null; filter_reason: string | null; analysis_state: string | null; status: string | null; title: string } | undefined;
  // MISE À NIVEAU (Cowork #27) : depuis le 08/10, l'alerte e-mail Codeur arrive AVANT le flux RSS
  // et crée une fiche réduite au TITRE. L'item RSS (texte, budget, catégories) qui suivait était
  // traité en doublon : jamais analysé, verdict « à voir », aucune notification. Désormais il
  // complète la fiche puis suit le chemin normal. Une seule fois : la fiche ne reste pas « titre seul ».
  if (existing && !body.titleOnly && existing.analysis_state === TITLE_ONLY && existing.status === "a_repondre") {
    return upgradeTitleOnly(deps, body, existing.id, now);
  }
  if (existing) {
    return {
      ...base,
      id: existing.id,
      score: existing.fit_score,
      verdict: existing.filter_reason ? "ignore" : verdictOf(existing.fit_score),
      reasons: existing.filter_reason ? [existing.filter_reason] : (existing.fit_reasons ?? []),
      orion_url: orionUrl(deps.baseUrl, existing.id),
      duplicate: true,
    };
  }

  const row = {
    user_id: deps.userId,
    source: body.source ?? "rss",
    platform: body.platform,
    external_id: body.external_id,
    url: body.url,
    title: body.title,
    body: body.description || body.title,
    budget: body.budget_text,
    categories: body.categories,
    published_at: body.published_at,
    description_truncated: body.description_truncated,
  };
  const insert = async (extra: Record<string, unknown>): Promise<string | null> => {
    const { data, error } = await deps.db.from("opportunities").insert({ ...row, ...extra }).select("id").single();
    return error || !data ? null : (data as { id: string }).id;
  };

  // 2. Pré-filtre gratuit : gardée pour audit, aucun LLM.
  // Titre seul : pré-filtre sur le titre, avec les règles propres aux titres (plateformes #11).
  const filtered = body.titleOnly ? titleOnlyReason(body.title, body.budget_text) : prefilterReason({ title: body.title, description: body.description, categories: body.categories, budgetText: body.budget_text });
  if (filtered) {
    const id = await insert({ status: "ignoree", analysis_state: "filtre", filter_reason: filtered });
    if (!id) return ingestRace(deps, body, base);
    return { ...base, id, score: null, verdict: "ignore", reasons: [filtered], orion_url: orionUrl(deps.baseUrl, id), filtered: true };
  }

  // Catégorie Codeur (11/10/2026) : mission de lancement (alerte) ou CMS imposé (à voir).
  const lane = laneOf({ platform: body.platform, title: body.title, description: body.titleOnly ? "" : body.description, categories: body.categories, budget: body.budget_text, published_at: body.published_at }, now);
  const laneFields = lane ? { lane, reasons: [LANE_REASONS[lane]] } : null;

  // 2b. Titre seul : « À voir », aucun appel au modèle (le collage de l'annonce lancera l'analyse) —
  //     sauf mission de lancement : alerte tout de suite, pour répondre parmi les premiers.
  if (body.titleOnly) {
    const id = await insert({ analysis_state: TITLE_ONLY });
    if (!id) return ingestRace(deps, body, base);
    if (laneVerdict(lane, null) === "alerte") await markAlerted(deps, id);
    return { ...base, id, score: null, verdict: laneVerdict(lane, null), reasons: lane ? [LANE_REASONS[lane], TITLE_ONLY_NOTE] : [TITLE_ONLY_NOTE], orion_url: orionUrl(deps.baseUrl, id), title_only: true, ...(lane ? { lane } : {}) };
  }

  // 3. Plafond quotidien d'analyses LLM.
  const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const { data: today } = await deps.db.from("opportunities").select("id").eq("user_id", deps.userId).in("source", ["rss", "email"]).gte("analyzed_at", dayStart);
  if ((today ?? []).length >= (deps.llmCap ?? DEFAULT_DAILY_LLM_CAP)) {
    const id = await insert({ analysis_state: "a_analyser" });
    if (!id) return ingestRace(deps, body, base);
    if (laneVerdict(lane, null) === "alerte") await markAlerted(deps, id);
    return { ...base, id, score: null, verdict: laneVerdict(lane, null), reasons: [...(laneFields?.reasons ?? []), "plafond quotidien d'analyses atteint : à analyser"], orion_url: orionUrl(deps.baseUrl, id), ...(lane ? { lane } : {}) };
  }

  // 4. Analyse sous échéance ; la proposition suit en arrière-plan.
  const id = await insert({ analysis_state: "pending" });
  if (!id) return ingestRace(deps, body, base);
  const analysisWork = analyzeRow(deps, id, body, lane);
  const finish = (analysis: Analysis | null) => (lane === "lancement" || (analysis && analysis.score >= PROPOSAL_SCORE) ? proposeRow(deps, id, body, analysis, lane) : Promise.resolve());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deps.deadlineMs ?? INGEST_DEADLINE_MS);
  });
  const first = await Promise.race([analysisWork, timeout]);
  clearTimeout(timer);
  if (first === "timeout") {
    // Trop lent pour la réponse : on finit en arrière-plan. Avant Cowork #27, aucune alerte ne
    // partait pour cet item (n8n n'a que la réponse) : ORION notifie lui-même si l'analyse finit
    // à 8 ou plus. Une mission de lancement ou de régie a déjà son verdict « alerte » ci-dessous.
    deps.background?.(
      analysisWork.then(async (analysis) => {
        await finish(analysis);
        if (!lane) await notifyLateAlert(deps, id, body, analysis, lane);
      }),
    );
    // Mission de lancement : l'alerte ne dépend pas de l'analyse, elle part tout de suite.
    if (laneVerdict(lane, null) === "alerte") await markAlerted(deps, id);
    return { ...base, id, score: null, verdict: laneVerdict(lane, null), reasons: laneFields?.reasons ?? [], orion_url: orionUrl(deps.baseUrl, id), pending: true, ...(lane ? { lane } : {}) };
  }
  const analysis = first;
  const proposalWork = finish(analysis);
  if (deps.background) deps.background(proposalWork);
  else await proposalWork;
  // L'analyse repasse : les « Non analysées » récentes sont rattrapées (arrière-plan).
  if (analysis && deps.background) deps.background(catchUpUnanalyzed(deps).catch(() => 0));
  if (laneVerdict(lane, analysis?.score ?? null) === "alerte") await markAlerted(deps, id);
  return {
    ...base,
    id,
    score: analysis?.score ?? null,
    verdict: laneVerdict(lane, analysis?.score ?? null),
    reasons: [...(laneFields?.reasons ?? []), ...(analysis?.reasons ?? ["analyse indisponible : à analyser"])],
    ...(analysis ? {} : { not_analyzed: true as const }),
    orion_url: orionUrl(deps.baseUrl, id),
    ...(lane ? { lane } : {}),
  };
}

/**
 * Complète une fiche « titre seul » avec l'item RSS, puis pré-filtre, catégorie et analyse
 * comme une annonce neuve. Si l'alerte e-mail avait déjà déclenché une notification (mission
 * de lancement repérée sur le titre seul), la réponse le dit (`duplicate`) : n8n ne renotifie pas.
 */
async function upgradeTitleOnly(deps: IngestDeps, body: IngestBody, id: string, now: Date): Promise<IngestResponse> {
  const base = { title: body.title, url: body.url };
  const stamp = now.toISOString();
  await deps.db
    .from("opportunities")
    .update({ body: body.description || body.title, budget: body.budget_text, categories: body.categories, description_truncated: body.description_truncated, published_at: body.published_at, updated_at: stamp })
    .eq("id", id);

  const filtered = prefilterReason({ title: body.title, description: body.description, categories: body.categories, budgetText: body.budget_text });
  if (filtered) {
    await deps.db.from("opportunities").update({ status: "ignoree", analysis_state: "filtre", filter_reason: filtered, updated_at: stamp }).eq("id", id).eq("status", "a_repondre");
    return { ...base, id, score: null, verdict: "ignore", reasons: [filtered], orion_url: orionUrl(deps.baseUrl, id), filtered: true };
  }
  const lane = laneOf({ platform: body.platform, title: body.title, description: body.description, categories: body.categories, budget: body.budget_text, published_at: body.published_at }, now);
  await deps.db.from("opportunities").update({ analysis_state: "pending", updated_at: stamp }).eq("id", id);
  const analysis = await analyzeRow(deps, id, body, lane);
  const proposal = lane === "lancement" || (analysis && analysis.score >= PROPOSAL_SCORE) ? proposeRow(deps, id, body, analysis, lane).catch(() => undefined) : Promise.resolve();
  if (deps.background) deps.background(proposal);
  else await proposal;
  const verdict = laneVerdict(lane, analysis?.score ?? null);
  // Alerte déjà signalée au passage de l'e-mail (trace en base) : n8n ne renotifie pas.
  const alreadyAlerted = verdict === "alerte" && !(await markAlerted(deps, id));
  return {
    ...base,
    id,
    score: analysis?.score ?? null,
    verdict,
    reasons: [...(lane ? [LANE_REASONS[lane]] : []), ...(analysis?.reasons ?? ["analyse indisponible : à analyser"])],
    ...(analysis ? {} : { not_analyzed: true as const }),
    orion_url: orionUrl(deps.baseUrl, id),
    ...(lane ? { lane } : {}),
    ...(alreadyAlerted ? { duplicate: true as const } : {}),
  };
}

/** Insertion refusée (deux appels simultanés pour la même annonce) : on renvoie la ligne existante. */
async function ingestRace(deps: IngestDeps, body: IngestBody, base: { title: string; url: string | null }): Promise<IngestResponse> {
  const { data } = await deps.db.from("opportunities").select("id, fit_score, fit_reasons").eq("user_id", deps.userId).eq("platform", body.platform).eq("external_id", body.external_id).limit(1);
  const row = (data ?? [])[0] as { id: string; fit_score: number | null; fit_reasons: string[] | null } | undefined;
  if (!row) throw new Error("opportunité non enregistrée");
  return { ...base, id: row.id, score: row.fit_score, verdict: verdictOf(row.fit_score), reasons: row.fit_reasons ?? [], orion_url: orionUrl(deps.baseUrl, row.id), duplicate: true };
}

/**
 * Annonce complète collée sur une fiche « Titre seul » (plateformes #11) : l'analyse
 * normale tourne ; l'alerte part au même seuil que la veille (score ≥ 8). Sur une autre
 * fiche, « Régénérer » n'alerte jamais (Axel est déjà dans l'app).
 */
export const shouldAlertAfterPaste = (previousState: string | null | undefined, score: number | null | undefined): boolean =>
  previousState === TITLE_ONLY && score != null && score >= ALERT_SCORE;
