/**
 * Enregistre les VRAIES fiches annuaire des entreprises citées par les
 * fixtures de l'entonnoir.
 *
 *   npx tsx scripts/record-funnel-fiches.ts
 *
 * Les fixtures portaient des SIREN fictifs (900000001, 900000002…) et des
 * valeurs supposées. L'une d'elles était fausse et faussait un test : on y
 * écrivait `diffusion: "P"` pour DBP MEDICAL, en croyant que l'annuaire
 * signalait ainsi son opposition à la prospection. L'API rend en réalité
 * `statut_diffusion: "O"` — la fiche est diffusible, et l'opposition n'est
 * portée que par Pappers (`opposition_utilisation_commerciale`).
 *
 * Le fichier produit est lu par scripts/funnel-fixtures.ts. Gratuit et sans
 * clé : `recherche-entreprises.api.gouv.fr` est une API publique.
 */
import { writeFileSync } from "node:fs";
import type { CompanyBase } from "../lib/enrichment/types";

/** Les entreprises des cas nommés, avec leur SIREN réel. */
const SIRENS: Record<string, string> = {
  artflex: "520644386",
  sunr: "501428676",
  devesa: "444866008",
  dbp: "844687566",
  global2f: "833040736",
  adviso: "808611990",
  delica: "432158012",
  champeil: "422684027",
  humanSight: "912176435",
};

/*
 * « LOGIFLUX » n'est pas enregistre : c'est un TEMOIN synthetique, une hausse
 * de capital de +150 % qui doit rester une croissance. Lui coller une vraie
 * societe au hasard rendrait le test faux plutot que reel.
 */

const ANNUAIRE = "https://recherche-entreprises.api.gouv.fr/search";

async function fiche(siren: string): Promise<CompanyBase | null> {
  const response = await fetch(`${ANNUAIRE}?q=${siren}&per_page=1`, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const body = (await response.json()) as { results?: Record<string, never>[] };
  const raw = body.results?.[0] as Record<string, unknown> | undefined;
  if (!raw) return null;

  const siege = (raw.siege ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const naf = text(siege.activite_principale) ?? text(raw.activite_principale);

  return {
    siren: text(raw.siren),
    company_name: text(raw.nom_complet) ?? siren,
    website: null,
    email: null,
    sector: null,
    size_range: null,
    city: text(siege.libelle_commune),
    postal_code: text(siege.code_postal),
    naf_code: naf,
    naf_section: text(raw.section_activite_principale),
    founded_year: Number((text(raw.date_creation) ?? "").slice(0, 4)) || null,
    legal_form: text(raw.nature_juridique),
    leader: null,
    leader_person: null,
    parent_company: null,
    matched_branch: false,
    figures: {
      founded_on: text(raw.date_creation),
      effectif_code: text(raw.tranche_effectif_salarie),
      legal_code: text(raw.nature_juridique),
      revenue_eur: null,
      revenue_year: null,
      net_income_eur: null,
      company_category: text(raw.categorie_entreprise),
      head_office_city: text(siege.libelle_commune),
      // « O » = fiche diffusible. Ce champ NE DIT RIEN de la prospection.
      diffusion: text(raw.statut_diffusion),
      administrative_state: text(raw.etat_administratif),
    },
  } as CompanyBase;
}

async function main(): Promise<void> {
  const out: Record<string, CompanyBase | null> = {};
  for (const [key, siren] of Object.entries(SIRENS)) {
    const company = await fiche(siren);
    out[key] = company;
    console.log(
      `${key.padEnd(12)} ${siren} → ${company?.company_name ?? "INTROUVABLE"} · ${company?.city ?? "?"} · NAF ${company?.naf_code ?? "?"} · effectif ${company?.figures.effectif_code ?? "?"} · diffusion ${company?.figures.diffusion ?? "?"}`,
    );
  }
  writeFileSync(
    "scripts/fixtures/funnel-fiches.json",
    `${JSON.stringify({ recordedAt: new Date().toISOString().slice(0, 10), source: ANNUAIRE, fiches: out }, null, 2)}\n`,
    "utf8",
  );
  console.log("\nscripts/fixtures/funnel-fiches.json écrit.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
