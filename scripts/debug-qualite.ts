/**
 * Diagnostic des défauts de qualité observés en production.
 *
 * Chaque bloc reproduit un cas REEL avant qu'on y touche : filtre d'effectif
 * ignoré, effectif absurde affiché, signaux qui n'en sont pas, scores
 * indiscernables. On imprime ce que les APIs renvoient vraiment, jamais une
 * hypothèse.
 *
 *   npx tsx scripts/debug-qualite.ts effectif
 *   npx tsx scripts/debug-qualite.ts pappers
 *   npx tsx scripts/debug-qualite.ts signaux
 *
 * Les blocs `pappers` et `signaux` consomment des crédits.
 */
import { existsSync, readFileSync } from "node:fs";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    if (!process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const ANNUAIRE = "https://recherche-entreprises.api.gouv.fr/search";
const PAPPERS = "https://api.pappers.fr/v2/entreprise";

const title = (label: string) => console.log(`\n${"=".repeat(72)}\n${label}\n${"=".repeat(72)}`);

/** Les trois entreprises remontées à tort, plus le cas d'effectif absurde. */
const CASES = ["SEMAPHORES", "EG RETAIL (FRANCE)", "VIVAUTO PLVL", "ANDRA LEARNING"];

interface AnnuaireRow {
  siren?: string;
  nom_complet?: string;
  tranche_effectif_salarie?: string;
  siege?: { libelle_commune?: string };
}

async function annuaire(params: URLSearchParams) {
  const response = await fetch(`${ANNUAIRE}?${params}`, { headers: { accept: "application/json" } });
  const body = (await response.json()) as { results?: AnnuaireRow[]; total_results?: number };
  return { status: response.status, total: body.total_results ?? 0, results: body.results ?? [] };
}

async function blockEffectif(): Promise<void> {
  title("(1) FILTRE D'EFFECTIF — l'annuaire respecte-t-il la tranche ?");

  // « 10 à 49 salariés » = tranches INSEE 11 et 12.
  const params = new URLSearchParams({
    page: "1",
    per_page: "20",
    etat_administratif: "A",
    tranche_effectif_salarie: "11,12",
  });
  const { total, results } = await annuaire(params);
  const outside = results.filter(
    (row) => !["11", "12"].includes(row.tranche_effectif_salarie ?? ""),
  );
  console.log(
    `\nRecherche tranche=11,12 · total ${total}` +
      `\n  ${results.length} resultats, dont ${outside.length} HORS tranche` +
      `\n  → l'API filtre ${outside.length === 0 ? "CORRECTEMENT" : "MAL"}`,
  );

  console.log("\nTranche INSEE reelle des entreprises vues en prod :");
  for (const name of CASES) {
    const search = new URLSearchParams({ q: name, page: "1", per_page: "1" });
    const { results: found } = await annuaire(search);
    const row = found[0];
    console.log(
      `  ${(row?.nom_complet ?? name).padEnd(34)} SIREN ${row?.siren ?? "?"}` +
        ` · tranche annuaire = ${row?.tranche_effectif_salarie ?? "(absente)"}`,
    );
  }
  console.log(
    "\n→ si la tranche annuaire est bien 11/12, le depassement vient d'AILLEURS" +
      " que de la recherche : de l'enrichissement Pappers.",
  );
}

interface PappersFinanceRaw {
  annee?: number;
  effectif?: number | null;
  chiffre_affaires?: number | null;
}

async function blockPappers(): Promise<void> {
  title("(1)(2) PAPPERS — quels champs d'effectif renvoie-t-il vraiment ?");
  const token = process.env.PAPPERS_API_KEY;
  if (!token) {
    console.log("\nPAPPERS_API_KEY absente : bloc ignore.");
    return;
  }

  for (const name of CASES) {
    const search = new URLSearchParams({ q: name, page: "1", per_page: "1" });
    const { results } = await annuaire(search);
    const siren = results[0]?.siren;
    if (!siren) {
      console.log(`\n${name} : SIREN introuvable.`);
      continue;
    }

    const response = await fetch(`${PAPPERS}?${new URLSearchParams({ api_token: token, siren })}`);
    if (!response.ok) {
      console.log(`\n${name} : Pappers HTTP ${response.status}`);
      continue;
    }
    const raw = (await response.json()) as {
      nom_entreprise?: string;
      effectif?: string;
      effectif_min?: number | null;
      effectif_max?: number | null;
      tranche_effectif?: string;
      annee_effectif?: number | null;
      finances?: PappersFinanceRaw[];
    };

    const finances = (raw.finances ?? [])
      .filter((item) => typeof item.annee === "number")
      .sort((a, b) => (b.annee ?? 0) - (a.annee ?? 0));
    const latest = finances.find((item) => item.chiffre_affaires != null) ?? finances[0];

    // C'est CE calcul que fait `fetchPappers` aujourd'hui.
    const current = latest?.effectif ?? raw.effectif_max ?? raw.effectif_min ?? null;

    console.log(
      `\n${raw.nom_entreprise ?? name} (SIREN ${siren})` +
        `\n  effectif (texte)      : ${raw.effectif ?? "—"}` +
        `\n  effectif_min / max    : ${raw.effectif_min ?? "—"} / ${raw.effectif_max ?? "—"}` +
        `\n  tranche_effectif      : ${raw.tranche_effectif ?? "—"}` +
        `\n  finances[0].effectif  : ${latest?.effectif ?? "—"} (annee ${latest?.annee ?? "?"})` +
        `\n  finances[0].CA        : ${latest?.chiffre_affaires ?? "—"}` +
        `\n  >> headcount retenu   : ${current}`,
    );
  }
  console.log(
    "\n→ un `finances[].effectif` exprime parfois une MASSE SALARIALE en euros," +
      " pas un nombre de personnes : c'est ce qui produit « 500000 salaries ».",
  );
}

async function blockSignaux(): Promise<void> {
  title("(3) SIGNAUX — ce que le scan retient aujourd'hui");
  const { hasLinkupKey, fetchWebResults } = await import("@/lib/enrichment/linkup");
  const { qualifyWebResults } = await import("@/lib/enrichment/signals");
  const { heatScore, heatContextOf } = await import("@/lib/scoring");

  if (!hasLinkupKey()) {
    console.log("\nLINKUP_API_KEY absente : bloc ignore.");
    return;
  }

  for (const name of ["SEMAPHORES", "EG RETAIL (FRANCE)", "VIVAUTO PLVL"]) {
    const search = new URLSearchParams({ q: name, page: "1", per_page: "1" });
    const { results } = await annuaire(search);
    const row = results[0];
    if (!row?.siren) continue;

    const base = {
      siren: row.siren,
      company_name: row.nom_complet ?? name,
      website: null,
      email: null,
      sector: null,
      size_range: null,
      city: row.siege?.libelle_commune ?? null,
      postal_code: null,
      naf_code: null,
      naf_section: null,
      founded_year: null,
      legal_form: null,
      leader: null,
      leader_person: null,
      parent_company: null,
      matched_branch: false,
      figures: {},
    };

    const web = await fetchWebResults({ name: base.company_name, city: base.city });
    const signals = web.ok
      ? qualifyWebResults(web.data, { name: base.company_name, website: null })
      : [];
    const score = heatScore(signals, { seed: base.company_name, context: heatContextOf({}) });

    console.log(`\n${base.company_name} — score ${score.value}/100`);
    for (const line of score.breakdown) {
      console.log(`    ${line.points > 0 ? "+" : ""}${line.points.toFixed(1).padStart(6)}  ${line.label}`);
    }
    for (const signal of signals) {
      const host = signal.url ? new URL(signal.url).hostname.replace(/^www\./, "") : "?";
      console.log(
        `    · [${signal.type}] ${host} · conf=${signal.confidence ?? "—"}` +
          ` · date=${signal.date ?? "aucune"}\n      ${String(signal.label).slice(0, 110)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const blocks: Record<string, () => Promise<void>> = {
    effectif: blockEffectif,
    pappers: blockPappers,
    signaux: blockSignaux,
  };
  for (const [name, run] of Object.entries(blocks)) {
    if (only ? only !== name : name !== "effectif") continue;
    await run();
  }
  console.log("");
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
