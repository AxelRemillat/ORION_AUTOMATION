import type { AskFn } from "@/lib/ai/chat";
import { analyzeOpportunity, type Analysis } from "./analyze";
import { prefilterReason } from "./prefilter";
import { generateProposal } from "./proposal";
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
}

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
}

/** Texte vu par l'analyse : titre, extrait et catégories (le flux n'a rien de plus). */
const analysisBody = (body: IngestBody) => [body.description, body.categories.length ? `Catégories : ${body.categories.join(" ; ")}` : ""].filter(Boolean).join("\n\n");

const orionUrl = (baseUrl: string, id: string) => `${baseUrl.replace(/\/$/, "")}/opportunites?id=${encodeURIComponent(id)}`;

/** Analyse puis écriture ; renvoie l'analyse (ou null si indisponible). */
async function analyzeRow(deps: IngestDeps, id: string, body: IngestBody): Promise<Analysis | null> {
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
            // Sous 5 : rangée avec les ignorées (Axel peut toujours la rouvrir).
            ...(statusAfterAnalysis("a_repondre", analysis.score) ? { status: statusAfterAnalysis("a_repondre", analysis.score) } : {}),
            updated_at: now,
          }
        : { analysis_state: "a_analyser", updated_at: now },
    )
    .eq("id", id);
  return analysis;
}

/** Proposition (score ≥ 7) : brouillon sur extrait, une réécriture au plus (coût ≤ ~0,01 €). */
async function proposeRow(deps: IngestDeps, id: string, body: IngestBody, analysis: Analysis): Promise<void> {
  const proposal = await generateProposal({
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
  });
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
      updated_at: (deps.now ?? (() => new Date()))().toISOString(),
    })
    .eq("id", id);
}

export async function ingestOpportunity(deps: IngestDeps, body: IngestBody): Promise<IngestResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const base = { title: body.title, url: body.url };

  // 1. Idempotence : une annonce = une ligne, jamais deux analyses.
  const { data: known } = await deps.db
    .from("opportunities")
    .select("id, fit_score, fit_reasons, filter_reason")
    .eq("user_id", deps.userId)
    .eq("platform", body.platform)
    .eq("external_id", body.external_id)
    .limit(1);
  const existing = (known ?? [])[0] as { id: string; fit_score: number | null; fit_reasons: string[] | null; filter_reason: string | null } | undefined;
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
    source: "rss",
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
  const filtered = prefilterReason({ title: body.title, description: body.description, categories: body.categories, budgetText: body.budget_text });
  if (filtered) {
    const id = await insert({ status: "ignoree", analysis_state: "filtre", filter_reason: filtered });
    if (!id) return ingestRace(deps, body, base);
    return { ...base, id, score: null, verdict: "ignore", reasons: [filtered], orion_url: orionUrl(deps.baseUrl, id), filtered: true };
  }

  // 3. Plafond quotidien d'analyses LLM.
  const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const { data: today } = await deps.db.from("opportunities").select("id").eq("user_id", deps.userId).eq("source", "rss").gte("analyzed_at", dayStart);
  if ((today ?? []).length >= (deps.llmCap ?? DEFAULT_DAILY_LLM_CAP)) {
    const id = await insert({ analysis_state: "a_analyser" });
    if (!id) return ingestRace(deps, body, base);
    return { ...base, id, score: null, verdict: "a_voir", reasons: ["plafond quotidien d'analyses atteint : à analyser"], orion_url: orionUrl(deps.baseUrl, id) };
  }

  // 4. Analyse sous échéance ; la proposition suit en arrière-plan.
  const id = await insert({ analysis_state: "pending" });
  if (!id) return ingestRace(deps, body, base);
  const analysisWork = analyzeRow(deps, id, body);
  const finish = (analysis: Analysis | null) => (analysis && analysis.score >= PROPOSAL_SCORE ? proposeRow(deps, id, body, analysis) : Promise.resolve());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deps.deadlineMs ?? INGEST_DEADLINE_MS);
  });
  const first = await Promise.race([analysisWork, timeout]);
  clearTimeout(timer);
  if (first === "timeout") {
    // Trop lent pour la réponse : on finit en arrière-plan, sans alerte push pour cet item.
    deps.background?.(analysisWork.then(finish));
    return { ...base, id, score: null, verdict: "a_voir", reasons: [], orion_url: orionUrl(deps.baseUrl, id), pending: true };
  }
  const analysis = first;
  const proposalWork = finish(analysis);
  if (deps.background) deps.background(proposalWork);
  else await proposalWork;
  return {
    ...base,
    id,
    score: analysis?.score ?? null,
    verdict: verdictOf(analysis?.score ?? null),
    reasons: analysis?.reasons ?? ["analyse indisponible : à analyser"],
    orion_url: orionUrl(deps.baseUrl, id),
  };
}

/** Insertion refusée (deux appels simultanés pour la même annonce) : on renvoie la ligne existante. */
async function ingestRace(deps: IngestDeps, body: IngestBody, base: { title: string; url: string | null }): Promise<IngestResponse> {
  const { data } = await deps.db.from("opportunities").select("id, fit_score, fit_reasons").eq("user_id", deps.userId).eq("platform", body.platform).eq("external_id", body.external_id).limit(1);
  const row = (data ?? [])[0] as { id: string; fit_score: number | null; fit_reasons: string[] | null } | undefined;
  if (!row) throw new Error("opportunité non enregistrée");
  return { ...base, id: row.id, score: row.fit_score, verdict: verdictOf(row.fit_score), reasons: row.fit_reasons ?? [], orion_url: orionUrl(deps.baseUrl, row.id), duplicate: true };
}
