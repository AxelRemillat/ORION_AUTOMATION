/**
 * Diagnostic de la recherche ORION, sur de vrais appels.
 *
 * Reproduit un a un les symptomes observes en production AVANT d'y toucher :
 * la zone ignoree, la pagination figee, l'absence de deduplication, le score
 * de BLUE ENERFREEZE, la datation des offres d'emploi. Chaque bloc imprime ce
 * qu'il a REELLEMENT recu, jamais une supposition.
 *
 *   npx tsx scripts/debug-search.ts
 *   npx tsx scripts/debug-search.ts zone        (un seul bloc)
 *   npx tsx scripts/debug-search.ts live        (relance reelle, PAYANTE)
 *   npx tsx scripts/debug-search.ts signaux     (mode « signaux d'abord », PAYANT)
 *
 * Seul le bloc `live` ecrit en base et consomme des credits.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resolveAndEnrich, searchAndEnrich } from "@/lib/enrichment";
import { searchCompanies } from "@/lib/enrichment/gouv";
import { fetchWebResults } from "@/lib/enrichment/linkup";
import { tranchesForBucket } from "@/lib/enrichment/naf";
import { collectSignals, searchBySignals } from "@/lib/signals";
import { sinceDate } from "@/lib/signals/bodacc";
import { guessOwnWebsite, qualifyWebResults, type QualifyTrace } from "@/lib/enrichment/signals";
import { heatContextOf, heatScore, whyNow } from "@/lib/scoring";
import type { Database } from "@/types";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}
loadEnv();

const ANNUAIRE = "https://recherche-entreprises.api.gouv.fr/search";

const title = (label: string) => console.log(`\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}`);

/** Reproduit EXACTEMENT ce que construisait `applyZone` avant le correctif. */
function legacyParams(zone: string | undefined, section: string, tranches: string[]): URLSearchParams {
  const params = new URLSearchParams({ page: "1", per_page: "20", etat_administratif: "A" });
  const terms: string[] = [];
  const value = zone?.trim();
  if (value) {
    if (/^\d{5}$/.test(value)) params.set("code_postal", value);
    else if (/^(\d{2}|\d{3}|2[AB])$/i.test(value)) params.set("departement", value.toUpperCase());
    else terms.push(value);
  }
  if (terms.length) params.set("q", terms.join(" "));
  if (section) params.set("section_activite_principale", section);
  if (tranches.length) params.set("tranche_effectif_salarie", tranches.join(","));
  return params;
}

interface AnnuaireRow {
  siren?: string;
  nom_complet?: string;
  siege?: { libelle_commune?: string };
  dirigeants?: {
    type_dirigeant?: string;
    nom?: string;
    prenoms?: string;
    denomination?: string;
    qualite?: string;
  }[];
}

async function annuaire(params: URLSearchParams) {
  const response = await fetch(`${ANNUAIRE}?${params}`, { headers: { accept: "application/json" } });
  const body = (await response.json()) as { results?: AnnuaireRow[]; total_results?: number };
  return { status: response.status, total: body.total_results ?? 0, results: body.results ?? [] };
}

async function blockZone(): Promise<void> {
  title("(a) ZONE — ce que l'API recevait reellement");
  const tranches = ["11", "12", "21"];
  for (const zone of ["", "Paris", "Lyon", "69003", "69"]) {
    const params = legacyParams(zone, "C", tranches);
    const { status, total, results } = await annuaire(params);
    const villes = results.slice(0, 5).map((row) => row.siege?.libelle_commune ?? "?").join(", ");
    console.log(
      `\nzone saisie : ${zone ? `« ${zone} »` : "(vide)"}` +
        `\n  parametres envoyes : ${params.toString()}` +
        `\n  HTTP ${status} · total annonce : ${total}` +
        `\n  5 premieres villes : ${villes}`,
    );
  }
}

async function blockPagination(): Promise<void> {
  title("(b) PAGINATION — la page etait-elle figee ?");
  const tranches = ["11", "12", "21"];
  const first = await annuaire(legacyParams("", "C", tranches));
  const params = legacyParams("", "C", tranches);
  params.set("page", "3");
  const third = await annuaire(params);
  const names = (rows: AnnuaireRow[]) => rows.slice(0, 3).map((row) => row.nom_complet ?? "?").join(" | ");
  console.log(`\npage 1 : ${names(first.results)}`);
  console.log(`page 3 : ${names(third.results)}`);
  console.log(
    "\nL'ancien code ne demandait jamais autre chose que page=1 : deux" +
      " recherches identiques rendaient donc exactement les memes entreprises.",
  );
}

async function blockGeo(): Promise<void> {
  title("(2) GEO.API.GOUV.FR — resolution de zone");
  for (const query of ["Paris", "Lyon", "Marseille", "69003", "69", "Zorglub"]) {
    const isPostal = /^\d{5}$/.test(query);
    const url = isPostal
      ? `https://geo.api.gouv.fr/communes?codePostal=${query}&fields=nom,code,codesPostaux,departement,population`
      : `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(query)}` +
        "&fields=nom,code,codesPostaux,departement,population&boost=population&limit=5";
    const response = await fetch(url);
    const rows = (await response.json()) as {
      nom?: string;
      code?: string;
      population?: number;
      departement?: { code?: string; nom?: string };
      codesPostaux?: string[];
    }[];
    const best = Array.isArray(rows) ? rows[0] : undefined;
    console.log(
      `\n« ${query} » → HTTP ${response.status} · ${Array.isArray(rows) ? rows.length : 0} commune(s)` +
        (best
          ? `\n  meilleure : ${best.nom} (${best.departement?.code}) · INSEE ${best.code}` +
            ` · ${best.codesPostaux?.length ?? 0} code(s) postal(aux) · ${best.population ?? "?"} hab.`
          : "\n  aucune correspondance"),
    );
  }
}

async function blockBlue(): Promise<void> {
  title("(c)(d) BLUE ENERFREEZE — fiche, dirigeant, groupe");
  const params = new URLSearchParams({ q: "BLUE ENERFREEZE", page: "1", per_page: "1" });
  const { results } = await annuaire(params);
  const company = results[0];
  console.log(`\nSIREN ${company?.siren} · ${company?.nom_complet}`);
  for (const person of company?.dirigeants ?? []) {
    const who = person.denomination ?? [person.prenoms, person.nom].filter(Boolean).join(" ");
    console.log(`  dirigeant : type=${person.type_dirigeant ?? "?"} · ${who} · qualite=${person.qualite ?? "?"}`);
  }
  console.log(
    "\n→ la personne physique existe dans l'annuaire : c'est l'affichage qui" +
      " remontait la personne morale.",
  );
}

async function blockJobPosting(): Promise<void> {
  title("(5) JSON-LD JobPosting — l'offre est-elle datable ?");
  const pages = [
    "https://www.blue-enerfreeze.com/offre-demploi-automaticienne",
    "https://www.blue-enerfreeze.com/nous-rejoindre",
  ];
  for (const url of pages) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 ORION-diagnostic" } });
      const html = await response.text();
      const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
      const types = blocks.map((match) => {
        try {
          const parsed = JSON.parse(match[1].trim()) as { "@type"?: string | string[] };
          const type = parsed["@type"];
          return Array.isArray(type) ? type.join("/") : (type ?? "?");
        } catch {
          return "illisible";
        }
      });
      console.log(
        `\n${url}` +
          `\n  HTTP ${response.status} · ${html.length} caracteres` +
          `\n  blocs JSON-LD : ${blocks.length}${types.length ? ` (${types.join(", ")})` : ""}` +
          `\n  mention "JobPosting" : ${/JobPosting/i.test(html) ? "oui" : "non"}` +
          ` · mention "automaticien" : ${/automaticien/i.test(html) ? "oui" : "non"}`,
      );
    } catch (cause) {
      console.log(`\n${url}\n  ECHEC : ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}

/**
 * (8) RELANCE REELLE de la chaine corrigee.
 *
 * Consomme des appels payants (Linkup, Pappers, OpenAI). Le cout est mesure en
 * lisant `api_usage` avant et apres : c'est la depense reellement enregistree
 * par l'application, pas une estimation.
 */
async function blockLive(): Promise<void> {
  title("(8) RELANCE REELLE — deux recherches");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    console.log("\nNEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis : bloc ignore.");
    return;
  }
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  const { data: owner } = await supabase.from("prospects").select("user_id").limit(1).maybeSingle();
  const userId = owner?.user_id;
  if (!userId) {
    console.log("\nAucun utilisateur en base : bloc ignore.");
    return;
  }
  // Les couts d'un script ne s'enregistrent que si le proprietaire est explicite.
  process.env.ORION_SCRIPT_USER_ID = userId;

  const spent = async (): Promise<number> => {
    const { data } = await supabase.from("api_usage").select("cost").eq("user_id", userId);
    return (data ?? []).reduce((total, row) => total + Number(row.cost ?? 0), 0);
  };

  const runs: { label: string; zone?: string }[] = [
    { label: "zone vide · 10-49 salaries" },
    { label: "zone « Paris » · 10-49 salaries", zone: "Paris" },
  ];

  for (const run of runs) {
    const before = await spent();

    // Exclusion reelle : portefeuille, favoris, scans de moins de 30 jours,
    // SIREN exclus apres suppression definitive (meme regle que knownSirens).
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [prospects, favorites, scans, excluded] = await Promise.all([
      supabase.from("prospects").select("siren").eq("user_id", userId),
      supabase.from("favorites").select("siren").eq("user_id", userId),
      supabase.from("scan_history").select("siren").eq("user_id", userId).gte("scanned_at", since),
      supabase.from("excluded_companies").select("siren").eq("user_id", userId),
    ]);
    const exclude = new Set<string>();
    for (const rows of [prospects.data, favorites.data, scans.data, excluded.data]) {
      for (const row of rows ?? []) if (row.siren) exclude.add(row.siren);
    }

    const started = Date.now();
    const outcome = await searchAndEnrich(
      { section: "C", tranches: ["11", "12", "21"], zone: run.zone, limit: 5, scanWidth: 20 },
      {
        exclude,
        onScanned: async (rows) => {
          await supabase.from("scan_history").upsert(
            rows.map((row) => ({ ...row, user_id: userId, scanned_at: new Date().toISOString() })),
            { onConflict: "user_id,siren" },
          );
        },
      },
    );

    const after = await spent();
    console.log(`\n--- ${run.label} ---`);
    if ("error" in outcome) {
      console.log(`  ERREUR : ${outcome.error}`);
      continue;
    }

    console.log(
      [
        `  zone resolue    : ${outcome.zoneLabel ?? "(aucune)"}`,
        `  total annuaire  : ${outcome.totalCapped ? "plus de 10 000" : outcome.total}`,
        `  pages lues      : ${outcome.pagesRead}`,
        `  deja connues    : ${outcome.skippedKnown} (non rescannees)`,
        `  scannees        : ${outcome.scanned}`,
        `  avec signal     : ${outcome.withSignal}`,
        `  fiches ouvertes : ${outcome.analysed}`,
        `  arret           : ${outcome.stopReason}`,
        `  duree           : ${Math.round((Date.now() - started) / 1000)} s`,
        `  cout mesure     : ${(after - before).toFixed(4)} EUR`,
      ].join("\n"),
    );

    for (const company of outcome.results) {
      const score = heatScore(company.signals, {
        seed: company.siren ?? company.company_name,
        context: heatContextOf(company.key_figures),
      });
      const why = whyNow(company.signals);
      console.log(
        `    · ${company.company_name} (${company.city ?? "?"}) — ${score.value}/100` +
          `${why?.role ? ` · poste : ${why.role}` : ""}` +
          `${why?.when ? ` · ${why.when}` : ""}`,
      );
    }
    for (const warning of outcome.warnings) {
      console.log(`    ! ${warning.source} : ${warning.message}`);
    }
  }
}

/**
 * (5) Verification de bout en bout sur BLUE ENERFREEZE.
 *
 * Le cas de reference : une offre « Automaticien/ne » publiee sur le domaine
 * officiel, sans aucune date, et une appartenance au groupe STEF. Le score
 * doit refleter les deux — la moitie des points pour l'offre en ligne, le
 * malus de filiale — et le detail du calcul doit etre lisible.
 *
 * PAYANT : Linkup, Pappers et OpenAI sont appeles.
 */
async function blockBlueFull(): Promise<void> {
  title("(5) BLUE ENERFREEZE — enrichissement complet et detail du score");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (url && key) {
    const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });
    const { data: owner } = await supabase.from("prospects").select("user_id").limit(1).maybeSingle();
    if (owner?.user_id) process.env.ORION_SCRIPT_USER_ID = owner.user_id;
  }

  const outcome = await resolveAndEnrich("BLUE ENERFREEZE", { withSignals: true });
  if ("error" in outcome) {
    console.log(`\nECHEC : ${outcome.error}`);
    return;
  }

  const company = outcome.result;
  const figures = company.key_figures;
  const score = heatScore(company.signals, {
    seed: company.siren ?? company.company_name,
    context: heatContextOf(figures),
  });

  console.log(
    [
      `\n${company.company_name} · SIREN ${company.siren ?? "?"} · ${company.website ?? "site inconnu"}`,
      `  dirigeant (personne physique) : ${figures.leader_person ?? "—"}` +
        `${figures.leader_via ? ` (via ${String(figures.leader_via)})` : ""}`,
      `  dirigeant au registre         : ${figures.leader ?? "—"}`,
      `  societe mere                  : ${figures.parent_company ?? "—"}`,
      `  groupe detecte                : ${figures.parent_group ?? "—"}`,
      `  filiale de grand groupe       : ${figures.is_large_group_subsidiary === true ? "oui" : "non"}`,
      `  SCORE                         : ${score.value}/100 (${score.level})`,
    ].join("\n"),
  );

  console.log("\n  Detail du calcul :");
  for (const row of score.breakdown) {
    const sign = row.points > 0 ? "+" : "";
    console.log(`    ${sign}${row.points.toFixed(1).padStart(6)}  ${row.label}`);
  }

  console.log("\n  Signaux retenus :");
  for (const signal of company.signals ?? []) {
    console.log(
      `    · [${signal.type}] ${signal.label}` +
        `${signal.freshness ? ` · fraicheur=${String(signal.freshness)}` : ""}` +
        `${signal.liveOnOfficialSite ? " · compte a 50%" : ""}`,
    );
  }

  const why = whyNow(company.signals);
  console.log(
    why
      ? `\n  Pourquoi maintenant : poste=${why.role ?? "—"} · quand=${why.when ?? "—"}\n` +
        `    citation nettoyee : « ${why.headline} »`
      : "\n  Pourquoi maintenant : aucun signal citable.",
  );
}

/**
 * Entonnoir du scan, sur de vrais appels — PAYANT (une recherche Linkup par
 * entreprise). Repond a une seule question : entre 20 entreprises et 0 signal,
 * ou exactement le compte se perd-il ?
 */
async function blockFunnel(): Promise<void> {
  title("ENTONNOIR — la recherche du rapport, etape par etape (PAYANT)");

  const criteria = { tranches: tranchesForBucket("petite") };
  const search = await searchCompanies(criteria, 20, { page: 1 });
  if (!search.ok) return console.log(`annuaire illisible : ${search.error}`);

  const companies = search.data.companies.slice(0, 20);
  console.log(`Annuaire : ${companies.length} candidats sur ${search.data.total} annonces
`);

  const totals = { ok: 0, timeout: 0, error: 0, raw: 0, emitted: 0, withSignal: 0 };
  const durations: number[] = [];
  const reasons = new Map<string, number>();

  for (const base of companies) {
    const started = Date.now();
    const web = await fetchWebResults({
      name: base.company_name,
      city: base.city,
      website: base.website,
    });
    const ms = Date.now() - started;
    durations.push(ms);
    const label = base.company_name.slice(0, 32).padEnd(32);

    if (!web.ok) {
      const timedOut = web.error.includes("délai dépassé");
      if (timedOut) totals.timeout += 1;
      else totals.error += 1;
      console.log(`  ${String(ms).padStart(5)}ms  ${timedOut ? "DELAI  " : "ERREUR "} ${label} ${web.error}`);
      continue;
    }

    totals.ok += 1;
    const website = base.website ?? guessOwnWebsite(base.company_name, web.data);
    const trace: QualifyTrace = { raw: 0, emitted: 0, rejected: [] };
    const signals = qualifyWebResults(web.data, { name: base.company_name, website }, trace);
    totals.raw += trace.raw;
    totals.emitted += trace.emitted;
    if (signals.length) totals.withSignal += 1;
    for (const item of trace.rejected) {
      reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
    }
    console.log(
      `  ${String(ms).padStart(5)}ms  ok      ${label} ${String(trace.raw).padStart(3)} bruts -> ${signals.length} signal(aux)`,
    );
  }

  const sorted = durations.sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;

  console.log(`
--- TOTAUX -------------------------------------------------`);
  console.log(`Linkup     : ${totals.ok} ok · ${totals.timeout} délai dépassé · ${totals.error} erreur`);
  console.log(`Latence    : médiane ${at(0.5)} ms · p95 ${at(0.95)} ms · max ${at(1)} ms`);
  console.log(`Résultats  : ${totals.raw} bruts`);
  console.log(`Signaux    : ${totals.emitted} émis · ${totals.withSignal} entreprise(s) avec signal`);
  console.log(`
Rejets par raison :`);
  for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    const share = totals.raw ? ((100 * count) / totals.raw).toFixed(1) : "0.0";
    console.log(`  ${reason.padEnd(24)} ${String(count).padStart(5)}  (${share} %)`);
  }
}

/**
 * Mode « Signaux d'abord », de bout en bout — PAYANT (une fiche Pappers par
 * resultat). Repond a la question du critere d'acceptation : « departement 69,
 * 10-49 salaries, 5 fiches » rend-il 5 fiches portant un signal date de moins
 * de 60 jours, et a quel cout ?
 */
async function blockSignaux(): Promise<void> {
  title("SIGNAUX D'ABORD — BODACC + France Travail, mesure reelle (PAYANT)");

  const criteria = { departement: "69", tranches: tranchesForBucket("petite"), days: 60, limit: 5 };

  const startedAt = Date.now();
  const collected = await collectSignals(criteria);
  const collectMs = Date.now() - startedAt;

  console.log(`Sources (${collectMs} ms) :`);
  for (const source of collected.sources) {
    const state = source.available
      ? `${source.count} signaux retenus`
      : `INDISPONIBLE — ${source.unavailableReason}`;
    console.log(`  ${source.label.padEnd(24)} ${state}`);
  }
  for (const warning of collected.warnings) {
    console.log(`  avertissement : ${warning.message}`);
  }

  const window = sinceDate(criteria.days);
  const dated = collected.signals.filter((signal) => signal.date >= window);
  console.log("");
  console.log(
    `Signaux dates : ${collected.signals.length} au total, ${dated.length} dans la fenetre de ${criteria.days} jours`,
  );
  console.log(`  le plus recent : ${collected.signals[0]?.date ?? "aucun"}`);
  console.log(`  le plus ancien : ${collected.signals.at(-1)?.date ?? "aucun"}`);

  const resolveStart = Date.now();
  const outcome = await searchBySignals(criteria);
  const totalMs = Date.now() - resolveStart;

  console.log("");
  console.log(`Resolution + fiches (${totalMs} ms) :`);
  console.log(`  identites demandees a l'annuaire (gratuit) : ${outcome.lookups}`);
  console.log(`  fiches ouvertes chez Pappers (PAYANT)      : ${outcome.analysed}`);
  console.log(`  ecartees sur l'effectif                    : ${outcome.outOfBracket.length}`);
  console.log(`  deja connues                               : ${outcome.skippedKnown}`);
  console.log(`  signaux non rapproches                     : ${outcome.unmatched}`);

  console.log("");
  console.log("Fiches obtenues :");
  for (const company of outcome.results) {
    const signal = company.signals[0];
    const age = signal?.date ? Math.round((Date.now() - Date.parse(signal.date)) / 86_400_000) : null;
    console.log(
      `  ${company.company_name.slice(0, 32).padEnd(32)} ` +
        `${String(company.key_figures.headcount ?? "?").padStart(4)} sal.  ` +
        `${signal?.source ?? "?"} il y a ${age ?? "?"} j — ${signal?.label ?? "aucun signal"}`,
    );
  }
  for (const line of outcome.outOfBracket) {
    console.log(`  ecartee : ${line}`);
  }

  // Le cout par fiche est le seul chiffre comparable entre les deux modes : le
  // mode par criteres paie un appel Linkup par entreprise SCANNEE, celui-ci ne
  // paie qu'une fiche Pappers par entreprise RETENUE.
  const perFiche = outcome.analysed ? (outcome.lookups / outcome.analysed).toFixed(1) : "—";
  console.log("");
  console.log(
    `Rendement : ${outcome.analysed} fiches pour ${outcome.signalsFound} signaux lus et ` +
      `${outcome.lookups} identites resolues (${perFiche} identites gratuites par fiche, ` +
      `1 appel Pappers par fiche, 0 appel Linkup, 0 appel OpenAI).`,
  );

  const met = outcome.results.filter((company) => {
    const date = company.signals[0]?.date;
    return Boolean(date && date >= window);
  }).length;
  console.log(
    `Critere d'acceptation : ${met} fiche(s) avec un signal date de moins de ${criteria.days} jours ` +
      `(attendu : au moins 5) — ${met >= 5 ? "ATTEINT" : "NON ATTEINT"}`,
  );
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const blocks: Record<string, () => Promise<void>> = {
    zone: blockZone,
    pagination: blockPagination,
    geo: blockGeo,
    blue: blockBlue,
    job: blockJobPosting,
    bluefull: blockBlueFull,
    live: blockLive,
    funnel: blockFunnel,
    signaux: blockSignaux,
  };
  for (const [name, run] of Object.entries(blocks)) {
    // `live` est payant : il ne part jamais dans une execution complete.
    const payants = ["live", "bluefull", "funnel", "signaux"];
    if (only ? only !== name : payants.includes(name)) continue;
    await run();
  }
  console.log("");
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
