import { fetchCodeurFeeds } from "./codeur-rss";
import { ingestOpportunity, laneVerdict, NOT_ANALYZED, reanalyzeOpportunity, TITLE_ONLY, type IngestBody, type IngestDeps } from "./ingest";
import { laneOf } from "./lane";
import type { Platform } from "./types";

/**
 * RATTRAPAGE DES ALERTES CODEUR RATÉES (Cowork #27) — UNE SEULE FOIS, en production.
 *
 * Du 08 au 13/10/2026, les annonces arrivées d'abord par l'alerte e-mail sont restées
 * « titre seul » : jamais analysées, aucune notification. Ce rattrapage reprend les fiches
 * Codeur de moins de 48 h encore « À répondre » et jamais vraiment analysées :
 *   - « titre seul » : texte, budget et catégories relus dans les flux RSS officiels,
 *     puis le chemin normal (pré-filtre, catégorie, analyse) ;
 *   - « À analyser » / « Non analysée » : ré-analyse par le même code que l'ingestion.
 * Puis UNE notification récapitulative si au moins une passe en alerte — jamais une par offre.
 *
 * Coût : 25 analyses au plus (≈ 0,002 € chacune, propositions comprises < 0,20 €).
 * Verrou : une ligne `notification_log` — le rattrapage ne tourne qu'une fois, même si
 * plusieurs ingestions le déclenchent en même temps.
 */
export const RATTRAPAGE_KEY = "rattrapage:codeur-27";
export const RATTRAPAGE_HOURS = 48;
export const RATTRAPAGE_MAX_ANALYSES = 25;
/** Analyses lancées en parallèle : la fonction Vercel a 60 s. */
const BATCH = 5;

type Row = { id: string; external_id: string; title: string; body: string; budget: string | null; categories: string[] | null; published_at: string | null; analysis_state: string | null; url: string | null; description_truncated: boolean | null };

export interface CatchUpResult {
  ran: boolean;
  analyzed: number;
  alerts: { id: string; title: string }[];
}

/** Après cette date, le rattrapage n'est même plus tenté (pas d'écriture à chaque ingestion). */
export const RATTRAPAGE_UNTIL = "2026-10-16T00:00:00.000Z";

export async function runAlertCatchUp(deps: IngestDeps, fetchFn: typeof fetch = fetch): Promise<CatchUpResult> {
  const none: CatchUpResult = { ran: false, analyzed: 0, alerts: [] };
  if ((deps.now ?? (() => new Date()))().toISOString() >= RATTRAPAGE_UNTIL) return none;
  // Verrou : la clé est unique ; un second appel échoue à l'insertion et s'arrête là.
  const { error: locked } = await deps.db.from("notification_log").insert({ key: RATTRAPAGE_KEY, user_id: deps.userId, kind: "rattrapage" });
  if (locked) return none;

  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - RATTRAPAGE_HOURS * 3_600_000).toISOString();
  const { data } = await deps.db
    .from("opportunities")
    .select("id, external_id, title, body, budget, categories, published_at, analysis_state, url, description_truncated")
    .eq("user_id", deps.userId)
    .eq("platform", "codeur")
    .eq("status", "a_repondre")
    .in("analysis_state", [TITLE_ONLY, "a_analyser", NOT_ANALYZED])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = ((data ?? []) as Row[]).slice(0, RATTRAPAGE_MAX_ANALYSES);
  if (!rows.length) return { ...none, ran: true };

  const feeds = rows.some((row) => row.analysis_state === TITLE_ONLY) ? await fetchCodeurFeeds(fetchFn) : new Map<string, IngestBody>();
  const alerts: CatchUpResult["alerts"] = [];
  let analyzed = 0;

  const one = async (row: Row): Promise<void> => {
    if (row.analysis_state === TITLE_ONLY) {
      // Sans l'item RSS (sorti des flux), une fiche réduite au titre reste « À voir ».
      const item = feeds.get(row.external_id);
      if (!item) return;
      const result = await ingestOpportunity(deps, item);
      analyzed += 1;
      if (result.verdict === "alerte" && !result.duplicate) alerts.push({ id: result.id, title: result.title });
      return;
    }
    const body: IngestBody = {
      platform: "codeur" as Platform,
      external_id: row.external_id,
      url: row.url,
      title: row.title,
      description: row.body,
      description_truncated: row.description_truncated === true,
      budget_text: row.budget,
      categories: row.categories ?? [],
      published_at: row.published_at,
    };
    const lane = laneOf({ platform: "codeur", title: row.title, description: row.body, categories: row.categories ?? [], budget: row.budget, published_at: row.published_at }, now);
    const analysis = await reanalyzeOpportunity(deps, row.id, body);
    analyzed += 1;
    if (laneVerdict(lane, analysis?.score ?? null) === "alerte") alerts.push({ id: row.id, title: row.title });
  };

  for (let start = 0; start < rows.length; start += BATCH) {
    await Promise.all(rows.slice(start, start + BATCH).map((row) => one(row).catch(() => undefined)));
  }

  if (alerts.length && deps.notify) {
    const list = alerts.slice(0, 6).map((alert) => `• ${alert.title}`).join("\n");
    await deps
      .notify({
        title: `Rattrapage veille Codeur : ${alerts.length} offre${alerts.length > 1 ? "s" : ""} ratée${alerts.length > 1 ? "s" : ""} en alerte`,
        body: `${list}${alerts.length > 6 ? `\n… et ${alerts.length - 6} autre(s)` : ""}`,
        priority: "high",
        tags: ["briefcase"],
        click: `${deps.baseUrl.replace(/\/$/, "")}/opportunites`,
      })
      .catch(() => undefined);
  }
  return { ran: true, analyzed, alerts };
}
