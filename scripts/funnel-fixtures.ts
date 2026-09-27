/**
 * Fixtures de l'entonnoir « signaux d'abord ».
 *
 * RECONSTITUÉES à partir des faits constatés en production et rapportés par
 * Axel (montants, motifs, sièges) : l'environnement cloud n'a accès ni à
 * BODACC ni à l'annuaire. SIREN fictifs. À remplacer par les réponses brutes
 * enregistrées lors du run local (scripts/funnel-run.ts --record).
 *
 * GLOBAL 2F : le brief dit « exclu » sans donner le motif. HYPOTHÈSE retenue
 * ici : 0 salarié (tranche 00). À confirmer au run local.
 */
import type { CompanyBase } from "../lib/enrichment/types";
import type { HarvestedSignal, SignalFacts } from "../lib/funnel/types";
import { signalHash } from "../lib/funnel/harvest";

export const TODAY = new Date("2026-09-27T06:00:00+02:00");

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
  text: "Modification du capital : capital social porté de 10 000,00 € à 10 959,76 €.",
  facts: { label: "Modification du capital", capitalAfter: 10_959.76, capitalBefore: 10_000 },
});
const sunr = signal("SUN'R GROUPE", {
  text: "Capital social augmenté de 400 000,00 € à 402 000,00 €.",
  facts: { label: "Modification du capital", capitalAfter: 402_000, capitalBefore: 400_000 },
});
const devesa = signal("BOULANGERIE DEVESA", {
  text: "Modification de la forme juridique : SAS devient EURL.",
  facts: { label: "Changement de forme juridique", signalType: "presse", strength: "faible" },
});
const dbp = signal("DBP MEDICAL", {
  text: "Modification de l'administration : Mme Claire MARTIN devient présidente.",
  facts: { label: "Claire Martin devient présidente", signalType: "direction", newLeaders: [{ firstName: "Claire", surname: "MARTIN", role: "présidente" }] },
});
const global2f = signal("GLOBAL 2F", {
  text: "Modification de l'administration : M. Karim BENALI devient gérant.",
  facts: { label: "Karim Benali devient gérant", signalType: "direction", newLeaders: [{ firstName: "Karim", surname: "BENALI", role: "gérant" }] },
});
const adviso = signal("ADVISO PARTNERS", {
  source: "linkup",
  url: "https://adviso-partners.com/operations/groupe-echelle",
  text: "ADVISO PARTNERS a conseillé le Groupe Échelle dans l'acquisition de trois sociétés de maintenance.",
  facts: { label: "Opération annoncée" },
});
const delica = signal("DELICADESSERT", {
  text: "Modification survenue suite au jugement du tribunal de commerce de Lyon du 12/09/2026.",
  facts: { label: "Modification au registre", signalType: "presse", strength: "faible" },
});
const champeil = signal("CHAMPEIL", {
  text: "Création d'un établissement secondaire à Lyon.",
  facts: { label: "Nouvel établissement ou siège", strength: "moyen", city: "Lyon" },
});
const humanSight = signal("HUMAN SIGHT", {
  source: "france-travail",
  siren: null,
  url: "https://candidat.francetravail.fr/offres/recherche/detail/123ABC",
  text: "Assistant ADV H/F",
  facts: { label: "Recrutement", signalType: "recrutement", jobTitle: "Assistant ADV H/F", city: "Lyon", postalCode: "69003" },
});
const growth = signal("LOGIFLUX", {
  text: "Capital social porté de 200 000,00 € à 500 000,00 €.",
  facts: { label: "Modification du capital", capitalAfter: 500_000, capitalBefore: 200_000 },
});

export const CASES: Record<string, Case> = {
  artflex: { name: "ARTFLEX", signal: artflex, company: base("ARTFLEX", { siren: artflex.siren, naf_code: "74.10Z" }) },
  sunr: { name: "SUN'R GROUPE", signal: sunr, company: base("SUN'R GROUPE", { siren: sunr.siren, naf_code: "35.11Z" }) },
  devesa: {
    name: "BOULANGERIE DEVESA",
    signal: devesa,
    company: base("BOULANGERIE DEVESA", { siren: devesa.siren, naf_code: "10.71C", figures: { effectif_code: "11" } }),
  },
  dbp: { name: "DBP MEDICAL", signal: dbp, company: base("DBP MEDICAL", { siren: dbp.siren, naf_code: "46.46Z", figures: { diffusion: "P" } }) },
  global2f: { name: "GLOBAL 2F", signal: global2f, company: base("GLOBAL 2F", { siren: global2f.siren, figures: { effectif_code: "00" } }) },
  adviso: { name: "ADVISO PARTNERS", signal: adviso, company: base("ADVISO PARTNERS", { siren: adviso.siren, naf_code: "64.99Z" }) },
  delica: { name: "DELICADESSERT", signal: delica, company: base("DELICADESSERT", { siren: delica.siren, naf_code: "10.71D" }) },
  champeil: {
    name: "CHAMPEIL",
    signal: champeil,
    company: base("CHAMPEIL", { siren: champeil.siren, city: "Bordeaux", naf_code: "46.69B", figures: { effectif_code: "21" } }),
  },
  humanSight: {
    name: "HUMAN SIGHT",
    signal: humanSight,
    company: base("HUMAN SIGHT", {
      siren: "812000111",
      city: "Lyon",
      matched_branch: true,
      naf_code: "70.22Z",
      figures: { head_office_city: "Puteaux", effectif_code: "21" },
    }),
  },
  growth: { name: "LOGIFLUX", signal: growth, company: base("LOGIFLUX", { siren: growth.siren, naf_code: "49.41A", figures: { effectif_code: "21" } }) },
};
