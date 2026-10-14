/**
 * LES ANNONCES CODEUR « TITRE SEUL » (Cowork #29) — liste, complète, analyse.
 *
 * Une fiche « titre seul » vient de l'alerte e-mail Codeur, arrivée avant le
 * flux RSS. Ce script :
 *   1. liste les fiches encore « titre seul » (date, titre, lien) ;
 *   2. cherche leur annonce complète dans le flux RSS OFFICIEL (aucune page
 *      Codeur lue) — l'e-mail, lui, ne porte que le titre ;
 *   3. avec `--apply`, passe celles qui sont dans le flux par l'analyse normale
 *      (`ingestOpportunity` : mise à niveau du titre seul, règles #177 —
 *      CMS / dev web = Lancement, régie = « dispo à vérifier ») ;
 *   4. les autres gardent leur titre : voie calculée sur le titre, sans appel payant.
 *
 * Aucun envoi : ni mail, ni ntfy, ni push. Coût OpenAI compté sous `agent3`
 * (USAGE_SOURCE) et plafonné (`--max-eur`, 0,30 € par défaut) : le script
 * s'arrête avant l'analyse suivante dès que le plafond est atteint.
 *
 *   npx tsx scripts/codeur-titre-seul.ts            # liste seule, gratuit
 *   npx tsx scripts/codeur-titre-seul.ts --apply    # analyse (payant, plafonné)
 */
import { loadEnv } from "./quality-live";

loadEnv();
process.env.USAGE_SOURCE = process.env.USAGE_SOURCE?.trim() || "agent3";

/* Imports après le chargement de l'environnement (modèles, prix lus au chargement). */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require("./quality-live") as typeof import("./quality-live");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetchCodeurFeeds } = require("@/lib/opportunities/codeur-rss") as typeof import("@/lib/opportunities/codeur-rss");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ingestOpportunity, laneVerdict } = require("@/lib/opportunities/ingest") as typeof import("@/lib/opportunities/ingest");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { laneOf } = require("@/lib/opportunities/lane") as typeof import("@/lib/opportunities/lane");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { opportunityAsk } = require("@/lib/opportunities/run") as typeof import("@/lib/opportunities/run");

const APPLY = process.argv.includes("--apply");
const maxArg = process.argv.indexOf("--max-eur");
const MAX_EUR = maxArg > 0 ? Number(process.argv[maxArg + 1]) : 0.3;
const BASE_URL = "https://orion.axelremillat.com";

type Row = { id: string; user_id: string; external_id: string | null; title: string; url: string | null; status: string; created_at: string; published_at: string | null };

const loose = db as unknown as { from: (table: string) => any };

/** Dépense OpenAI enregistrée sous `agent3` depuis `since`. */
async function spentSince(since: string): Promise<number> {
  const { data } = await loose.from("api_usage").select("cost").eq("service", "openai").eq("source", "agent3").gte("created_at", since);
  return ((data ?? []) as { cost: number }[]).reduce((total, row) => total + Number(row.cost ?? 0), 0);
}

async function main(): Promise<void> {
  const started = new Date().toISOString();
  const { data, error } = await loose
    .from("opportunities")
    .select("id, user_id, external_id, title, url, status, created_at, published_at")
    .eq("platform", "codeur")
    .eq("analysis_state", "titre_seul")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const feeds = await fetchCodeurFeeds();
  console.log(`${rows.length} fiche(s) Codeur « titre seul » ; ${feeds.size} annonce(s) dans le flux RSS officiel.${APPLY ? "" : " (liste seule : --apply pour analyser)"}\n`);

  const pending: Promise<unknown>[] = [];
  const lines: string[] = [];
  for (const row of rows) {
    const item = feeds.get(row.external_id ?? "");
    const link = row.url ?? `https://www.codeur.com/projects/${row.external_id}`;
    const date = row.created_at.slice(0, 10);
    if (!item) {
      // Texte perdu : la voie se calcule sur le titre, sans appel payant.
      const lane = laneOf({ platform: "codeur", title: row.title, description: "", categories: [], budget: null, published_at: row.published_at ?? row.created_at }, new Date());
      lines.push(`| ${date} | ${row.title} | ${link} | hors flux (texte indisponible) | ${lane ?? "—"} | titre seul |`);
      continue;
    }
    if (!APPLY) {
      lines.push(`| ${date} | ${row.title} | ${link} | dans le flux | à analyser | — |`);
      continue;
    }
    // Les coûts s'enregistrent par la clé service (api_usage.user_id = le propriétaire).
    process.env.ORION_SCRIPT_USER_ID = row.user_id;
    const spent = await spentSince(started);
    if (spent >= MAX_EUR) {
      lines.push(`| ${date} | ${row.title} | ${link} | dans le flux | non analysée (plafond ${MAX_EUR} € atteint) | — |`);
      continue;
    }
    const result = await ingestOpportunity(
      {
        db: db as never,
        userId: row.user_id,
        ask: opportunityAsk(),
        baseUrl: BASE_URL,
        llmCap: 1000,
        deadlineMs: 60_000,
        background: (work) => void pending.push(work.catch(() => undefined)),
        // Aucun envoi : ni ntfy (`notify`), ni notification PC (`onAlert`).
      },
      item,
    );
    const verdict = result.verdict ?? laneVerdict(result.lane ?? null, result.score ?? null);
    lines.push(`| ${date} | ${row.title} | ${link} | dans le flux (probablement ouverte) | ${result.lane ?? (result.score != null ? `${result.score}/10` : "—")} | ${verdict} |`);
  }
  await Promise.all(pending);

  console.log("| Reçue | Titre | Lien | Annonce complète | Voie / score | Verdict |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const line of lines) console.log(line);
  if (APPLY) console.log(`\nCoût OpenAI (source agent3) : ${(await spentSince(started)).toFixed(4)} € (plafond ${MAX_EUR} €).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
