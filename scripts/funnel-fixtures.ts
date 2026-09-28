/**
 * Fixtures de l'entonnoir « signaux d'abord ».
 *
 * Les FICHES viennent de l'annuaire public, enregistrées telles quelles par
 * `npx tsx scripts/record-funnel-fiches.ts` : SIREN réels, NAF réel, tranche
 * d'effectif réelle, statut de diffusion réel. Elles étaient auparavant
 * reconstituées avec des SIREN fictifs et des valeurs supposées — et l'une de
 * ces suppositions était fausse : on écrivait `diffusion: "P"` pour DBP MEDICAL
 * en croyant que l'annuaire signalait ainsi son opposition à la prospection.
 * L'API rend « O ». L'opposition n'est portée que par Pappers, et elle est donc
 * vérifiée à l'étage 4 (lib/funnel/eligible.ts), pas au filtre.
 *
 * Les TEXTES de signaux restent ceux relevés en production : ce sont de vraies
 * formulations BODACC et France Travail. Un seul cas est synthétique et le dit,
 * « LOGIFLUX » : c'est le témoin d'une hausse de capital franche.
 */
import { readFileSync } from "node:fs";
import type { CompanyBase } from "../lib/enrichment/types";
import type { HarvestedSignal, SignalFacts } from "../lib/funnel/types";
import { signalHash } from "../lib/funnel/harvest";

export const TODAY = new Date("2026-09-27T06:00:00+02:00");

/** Fiches annuaire enregistrées, par clé de cas. */
const FICHES = (
  JSON.parse(readFileSync("scripts/fixtures/funnel-fiches.json", "utf8")) as {
    fiches: Record<string, CompanyBase | null>;
  }
).fiches;

/** Fiche réelle d'un cas, éventuellement retouchée pour isoler une règle. */
function fiche(key: string, over: Partial<CompanyBase> = {}): CompanyBase {
  const recorded = FICHES[key];
  if (!recorded) throw new Error(`fiche non enregistrée : ${key} (lancer scripts/record-funnel-fiches.ts)`);
  return { ...recorded, ...over, figures: { ...recorded.figures, ...(over.figures ?? {}) } };
}

let counter = 0;
function signal(
  companyName: string,
  over: Partial<Omit<HarvestedSignal, "facts">> & { facts: Partial<SignalFacts> & Pick<SignalFacts, "label"> },
): HarvestedSignal {
  counter += 1;
  const source = over.source ?? "bodacc";
  const siren = over.siren === undefined ? String(900000000 + counter) : over.siren;
  const date = over.date ?? "2026-09-20";
  const text = over.text ?? over.facts.label;
  return {
    source,
    date,
    text,
    url: over.url ?? `https://www.bodacc.fr/annonce/${counter}`,
    siren,
    companyName,
    facts: { signalType: "croissance", strength: "fort", ...over.facts },
    hash: signalHash({ source, siren, companyName, date, text }),
  };
}

export function base(
  name: string,
  over: Omit<Partial<CompanyBase>, "figures"> & { figures?: Partial<CompanyBase["figures"]> } = {},
): CompanyBase {
  const { figures, ...rest } = over;
  return {
    siren: null, company_name: name, website: null, email: null, sector: null, size_range: null,
    city: "Lyon", postal_code: "69003", naf_code: "70.22Z", naf_section: "M", founded_year: 2010,
    legal_form: "SAS", leader: null, leader_person: null, parent_company: null, matched_branch: false,
    ...rest,
    figures: {
      founded_on: "2010-01-01", effectif_code: "12", legal_code: "5710", revenue_eur: null, revenue_year: null,
      net_income_eur: null, company_category: "PME", head_office_city: null, diffusion: "O", administrative_state: "A",
      ...figures,
    },
  };
}

/** Un cas nommé : le signal, sa fiche annuaire, et ce qu'on attend du filtre. */
export interface Case {
  name: string;
  signal: HarvestedSignal;
  company: CompanyBase | null;
}

const artflex = signal("ARTFLEX", {
  siren: "520644386",
  text: "Modification du capital : capital social porté de 10 000,00 € à 10 959,76 €.",
  facts: { label: "Modification du capital", capitalAfter: 10_959.76, capitalBefore: 10_000 },
});
const sunr = signal("SUN'R GROUPE", {
  siren: "501428676",
  text: "Capital social augmenté de 400 000,00 € à 402 000,00 €.",
  facts: { label: "Modification du capital", capitalAfter: 402_000, capitalBefore: 400_000 },
});
const devesa = signal("BOULANGERIE DEVESA", {
  siren: "444866008",
  text: "Modification de la forme juridique : SAS devient EURL.",
  facts: { label: "Changement de forme juridique", signalType: "presse", strength: "faible" },
});
const dbp = signal("DBP MEDICAL", {
  siren: "844687566",
  text: "Modification de l'administration : Mme Claire MARTIN devient présidente.",
  facts: { label: "Claire Martin devient présidente", signalType: "direction", newLeaders: [{ firstName: "Claire", surname: "MARTIN", role: "présidente" }] },
});
const global2f = signal("GLOBAL 2F", {
  siren: "833040736",
  text: "Modification de l'administration : M. Karim BENALI devient gérant.",
  facts: { label: "Karim Benali devient gérant", signalType: "direction", newLeaders: [{ firstName: "Karim", surname: "BENALI", role: "gérant" }] },
});
const adviso = signal("ADVISO PARTNERS", {
  siren: "808611990",
  source: "linkup",
  url: "https://adviso-partners.com/operations/groupe-echelle",
  text: "ADVISO PARTNERS a conseillé le Groupe Échelle dans l'acquisition de trois sociétés de maintenance.",
  facts: { label: "Opération annoncée" },
});
const delica = signal("DELICADESSERT", {
  siren: "432158012",
  text: "Modification survenue suite au jugement du tribunal de commerce de Lyon du 12/09/2026.",
  facts: { label: "Modification au registre", signalType: "presse", strength: "faible" },
});
const champeil = signal("CHAMPEIL", {
  siren: "422684027",
  text: "Création d'un établissement secondaire à Lyon.",
  facts: { label: "Nouvel établissement ou siège", strength: "moyen", city: "Lyon" },
});
const humanSight = signal("HUMAN SIGHT", {
  source: "france-travail",
  siren: "912176435",
  url: "https://candidat.francetravail.fr/offres/recherche/detail/123ABC",
  text: "Assistant ADV H/F",
  facts: { label: "Recrutement", signalType: "recrutement", jobTitle: "Assistant ADV H/F", city: "Lyon", postalCode: "69003" },
});
const growth = signal("LOGIFLUX", {
  text: "Capital social porté de 200 000,00 € à 500 000,00 €.",
  facts: { label: "Modification du capital", capitalAfter: 500_000, capitalBefore: 200_000 },
});

export const CASES: Record<string, Case> = {
  artflex: { name: "ARTFLEX", signal: artflex, company: fiche("artflex") },
  sunr: { name: "SUN'R GROUPE", signal: sunr, company: fiche("sunr") },
  devesa: { name: "BOULANGERIE DEVESA", signal: devesa, company: fiche("devesa") },
  dbp: { name: "DBP MEDICAL", signal: dbp, company: fiche("dbp") },
  global2f: { name: "GLOBAL 2F", signal: global2f, company: fiche("global2f") },
  adviso: { name: "ADVISO PARTNERS", signal: adviso, company: fiche("adviso") },
  delica: { name: "DELICADESSERT", signal: delica, company: fiche("delica") },
  champeil: { name: "CHAMPEIL", signal: champeil, company: fiche("champeil") },
  humanSight: {
    name: "HUMAN SIGHT",
    signal: humanSight,
    // Offre à Lyon, siège à Puteaux : c'est le cas du badge « décision au siège ».
    company: fiche("humanSight", { city: "Lyon", matched_branch: true }),
  },
  growth: {
    name: "LOGIFLUX",
    signal: growth,
    // Témoin SYNTHÉTIQUE, et le seul : +150 % de capital doit rester une croissance.
    company: base("LOGIFLUX", { siren: growth.siren, naf_code: "49.41A", figures: { effectif_code: "21" } }),
  },
};
