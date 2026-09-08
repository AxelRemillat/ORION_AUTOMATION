/**
 * Client recherche-entreprises.api.gouv.fr — annuaire public des entreprises.
 * Gratuit, sans clé : c'est le socle de la recherche et de la résolution de
 * SIREN (mode manuel). Toutes les autres sources viennent se greffer dessus.
 */
import { fetchJson, toDomain } from "./http";
import { effectifLabel } from "./naf";
import type { Result } from "./http";
import type { CompanyBase, SearchCriteria } from "./types";

const BASE_URL = "https://recherche-entreprises.api.gouv.fr/search";

interface GouvDirigeant {
  nom?: string;
  prenoms?: string;
  denomination?: string;
  qualite?: string;
}

/** Établissement retourné dans `matching_etablissements` (filtre géographique). */
interface GouvEtablissement {
  code_postal?: string;
  libelle_commune?: string;
  est_siege?: boolean;
  etat_administratif?: string;
}

interface GouvSiege {
  code_postal?: string;
  libelle_commune?: string;
  activite_principale?: string;
}

/** `finances` est indexé par année : { "2024": { ca, resultat_net } }. */
type GouvFinances = Record<string, { ca?: number | null; resultat_net?: number | null }>;

interface GouvResult {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  date_creation?: string;
  tranche_effectif_salarie?: string;
  activite_principale?: string;
  section_activite_principale?: string;
  nature_juridique?: string;
  categorie_entreprise?: string | null;
  finances?: GouvFinances | null;
  siege?: GouvSiege;
  matching_etablissements?: GouvEtablissement[];
  dirigeants?: GouvDirigeant[];
}

interface GouvResponse {
  results?: GouvResult[];
  total_results?: number;
}

/** Libellés des sections NAF, pour afficher un secteur lisible. */
const SECTION_LABELS: Record<string, string> = {
  A: "Agriculture", B: "Industries extractives", C: "Industrie manufacturière",
  D: "Énergie", E: "Eau & déchets", F: "Construction", G: "Commerce",
  H: "Transport & entreposage", I: "Hébergement & restauration",
  J: "Information & communication", K: "Finance & assurance", L: "Immobilier",
  M: "Conseil & ingénierie", N: "Services administratifs & soutien",
  O: "Administration publique", P: "Enseignement", Q: "Santé & action sociale",
  R: "Arts & spectacles", S: "Autres services", T: "Ménages employeurs",
  U: "Organismes extraterritoriaux",
};

/**
 * Catégories juridiques INSEE, réduites à leur niveau I (2 premiers chiffres) :
 * l'API renvoie un code ("5710"), inutilisable tel quel à l'écran.
 */
const LEGAL_FORMS: Record<string, string> = {
  "10": "Entrepreneur individuel", "51": "Société coopérative",
  "52": "Société en nom collectif", "53": "Société en commandite",
  "54": "SARL", "55": "SA à conseil d'administration", "56": "SA à directoire",
  "57": "SAS", "58": "Société européenne", "62": "Groupement d'intérêt économique",
  "65": "Société civile", "69": "Autre personne morale de droit privé",
  "92": "Association loi 1901", "93": "Fondation",
};

function formatLegalForm(code: string | undefined): string | null {
  if (!code) return null;
  return LEGAL_FORMS[code.slice(0, 2)] ?? code;
}

/** Retient l'exercice le plus récent publié. */
function latestFinance(finances: GouvFinances | null | undefined) {
  const years = Object.keys(finances ?? {}).sort().reverse();
  const year = years[0];
  if (!year || !finances) return { revenue_eur: null, revenue_year: null, net_income_eur: null };
  return {
    revenue_eur: finances[year].ca ?? null,
    revenue_year: finances[year].ca != null ? Number(year) || null : null,
    net_income_eur: finances[year].resultat_net ?? null,
  };
}

function formatLeader(dirigeants: GouvDirigeant[] | undefined): string | null {
  const first = dirigeants?.[0];
  if (!first) return null;
  if (first.denomination) return first.denomination;
  const name = [first.prenoms, first.nom].filter(Boolean).join(" ").trim();
  return name || null;
}

/**
 * `code_postal` / `departement` filtrent les ÉTABLISSEMENTS, pas le siège :
 * une entreprise remonte dès qu'une de ses antennes matche. On affiche donc le
 * site trouvé (et non le siège, souvent à l'autre bout de la France), et on
 * écarte les résultats dont le seul établissement local est fermé.
 */
function mapResult(raw: GouvResult, geoFiltered: boolean): CompanyBase | null {
  const name = raw.nom_complet ?? raw.nom_raison_sociale;
  if (!name) return null;

  // Sur une recherche plein texte, `matching_etablissements` contient des sites
  // sans rapport avec la zone : on ne s'en sert que si un filtre géo a été posé.
  const site = geoFiltered
    ? (raw.matching_etablissements ?? []).find((e) => e.etat_administratif !== "F")
    : undefined;
  if (geoFiltered && !site) return null;

  const headOffice = raw.siege?.libelle_commune ?? null;
  const city = site?.libelle_commune ?? headOffice;
  const section = raw.section_activite_principale ?? null;

  return {
    siren: raw.siren ?? null,
    company_name: name,
    website: null, // l'annuaire public n'expose pas de site web : Pappers le complète
    email: null, // idem pour l'adresse de contact
    sector: section ? (SECTION_LABELS[section] ?? section) : null,
    size_range: effectifLabel(raw.tranche_effectif_salarie),
    city,
    postal_code: site?.code_postal ?? raw.siege?.code_postal ?? null,
    naf_code: raw.activite_principale ?? raw.siege?.activite_principale ?? null,
    naf_section: section,
    founded_year: raw.date_creation ? Number(raw.date_creation.slice(0, 4)) || null : null,
    legal_form: formatLegalForm(raw.nature_juridique),
    leader: formatLeader(raw.dirigeants),
    matched_branch: Boolean(site && site.est_siege === false),
    figures: {
      effectif_code: raw.tranche_effectif_salarie ?? null,
      company_category: raw.categorie_entreprise ?? null,
      head_office_city: headOffice !== city ? headOffice : null,
      ...latestFinance(raw.finances),
    },
  };
}

/** Ajoute le filtre géographique le plus précis que la saisie permette. */
function applyZone(params: URLSearchParams, zone: string | undefined, terms: string[]): boolean {
  const value = zone?.trim();
  if (!value) return false;
  if (/^\d{5}$/.test(value)) params.set("code_postal", value);
  else if (/^(\d{2}|\d{3}|2[AB])$/i.test(value)) params.set("departement", value.toUpperCase());
  else {
    terms.push(value); // nom de commune : la recherche plein texte l'indexe
    return false;
  }
  return true;
}

export async function searchCompanies(
  criteria: SearchCriteria,
  perPage = 12,
): Promise<Result<{ companies: CompanyBase[]; total: number }>> {
  const params = new URLSearchParams({
    page: "1",
    per_page: String(perPage),
    etat_administratif: "A", // entreprises en activité uniquement
  });

  const terms: string[] = [];
  if (criteria.q?.trim()) terms.push(criteria.q.trim());
  const geoFiltered = applyZone(params, criteria.zone, terms);
  if (terms.length) params.set("q", terms.join(" "));
  if (criteria.section) params.set("section_activite_principale", criteria.section);
  if (criteria.tranches?.length) {
    params.set("tranche_effectif_salarie", criteria.tranches.join(","));
  }

  // L'API exige au moins un critère : sans rien, on renverrait l'annuaire entier.
  if (![...params.keys()].some((k) => !["page", "per_page", "etat_administratif"].includes(k))) {
    return { ok: false, error: "Renseignez au moins un critère (secteur, taille ou zone)." };
  }

  const response = await fetchJson<GouvResponse>(`${BASE_URL}?${params}`);
  if (!response.ok) return response;

  const companies = (response.data.results ?? [])
    .map((raw) => mapResult(raw, geoFiltered))
    .filter((company): company is CompanyBase => company !== null);

  return { ok: true, data: { companies, total: response.data.total_results ?? companies.length } };
}

/**
 * Résout une saisie libre (SIREN, nom d'entreprise ou URL) vers une identité.
 * Un SIREN est interrogé tel quel ; une URL est réduite à son nom de domaine,
 * dont le label sert de terme de recherche.
 */
export async function resolveCompany(query: string): Promise<Result<CompanyBase>> {
  const input = query.trim();
  if (!input) return { ok: false, error: "Saisie vide." };

  const digits = input.replace(/\s/g, "");
  const isSiren = /^\d{9}$/.test(digits);
  const isSiret = /^\d{14}$/.test(digits);
  const domain = toDomain(input);

  let term = input;
  if (isSiren || isSiret) term = digits.slice(0, 9);
  else if (domain) term = domain.split(".")[0];

  const response = await searchCompanies({ q: term }, isSiren || isSiret ? 1 : 5);
  if (!response.ok) return response;

  const [best] = response.data.companies;
  if (!best) return { ok: false, error: `Aucune entreprise trouvée pour « ${input} ».` };

  // Une URL saisie par l'utilisateur fait autorité sur le site du référentiel.
  return { ok: true, data: domain ? { ...best, website: best.website ?? `https://${domain}` } : best };
}
