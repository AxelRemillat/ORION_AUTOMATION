/**
 * Client recherche-entreprises.api.gouv.fr — annuaire public des entreprises.
 * Gratuit, sans clé : c'est le socle de la recherche et de la résolution de
 * SIREN (mode manuel). Toutes les autres sources viennent se greffer dessus.
 */
import { singleCompanyName } from "@/lib/company-name";
import { fetchJson, toDomain } from "./http";
import { cached } from "./cache";
import { ANNUAIRE_RATE_PER_SECOND, limitedFetch } from "./rate-limit";
import { effectifLabel } from "./naf";
import type { Result } from "./http";
import type { ResolvedZone } from "./geo";
import type { CompanyBase, SearchCriteria } from "./types";

const BASE_URL = "https://recherche-entreprises.api.gouv.fr/search";

/** Duree de cache d'une page d'annuaire. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface GouvDirigeant {
  type_dirigeant?: string;
  /** SIREN d'un dirigeant personne morale (holding) : l'annuaire le publie. */
  siren?: string;
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
  /**
   * Statut de diffusion INSEE : « O » diffusible, « P » partiellement
   * diffusible (l'entreprise a demandé à ne pas voir ses données exposées).
   */
  statut_diffusion?: string;
  /** « A » active, « C » cessée. */
  etat_administratif?: string;
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
 * Dirigeant PERSONNE PHYSIQUE, en casse naturelle.
 *
 * L'API renvoie « DUMONT » / « BENJAMIN ALEXANDRE » en capitales : inutilisable
 * tel quel dans une salutation. On ne garde que le premier prenom.
 */
function physicalLeader(dirigeants: GouvDirigeant[] | undefined): string | null {
  const person = dirigeants?.find(
    (item) => (item.type_dirigeant === "personne physique" || item.nom) && isOwnerRole(item.qualite),
  );
  if (!person?.nom) return null;
  const capitalize = (value: string) =>
    value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  const firstName = (person.prenoms ?? "").trim().split(/\s+/)[0] ?? "";
  return [firstName, person.nom]
    .filter(Boolean)
    .map((part) => part.split(/[-\s]/).map(capitalize).join("-"))
    .join(" ")
    .trim() || null;
}

/**
 * Qualites qui n'ont RIEN d'un actionnaire : controle legal et mandats
 * judiciaires. Un commissaire aux comptes figure parmi les « dirigeants » de
 * l'annuaire, et le prendre pour une societe mere faisait de JACQUET PARIS une
 * filiale d'Ernst & Young.
 */
const NON_OWNER_ROLE =
  /commissaire aux comptes|suppl[eé]ant|liquidateur|administrateur judiciaire|mandataire|expert-comptable/i;

/** Un representant qui peut reellement detenir l'entreprise. */
function isOwnerRole(qualite: string | undefined): boolean {
  return !qualite || !NON_OWNER_ROLE.test(qualite);
}

/**
 * Societe mere, quand un dirigeant est une PERSONNE MORALE.
 *
 * C'est l'indice d'appartenance a un groupe le plus fiable qu'on ait : il est
 * structure, date du registre, et ne depend d'aucune lecture de texte — a
 * condition d'ecarter les mandats de controle (cf. NON_OWNER_ROLE).
 */
function parentCompany(dirigeants: GouvDirigeant[] | undefined): string | null {
  const entity = dirigeants?.find(
    (item) =>
      (item.type_dirigeant === "personne morale" || Boolean(item.denomination)) &&
      isOwnerRole(item.qualite),
  );
  return entity?.denomination?.trim() || null;
}

/** SIREN de cette même société mère, quand l'annuaire le publie. */
function parentCompanySiren(dirigeants: GouvDirigeant[] | undefined): string | null {
  const entity = dirigeants?.find(
    (item) =>
      (item.type_dirigeant === "personne morale" || Boolean(item.denomination)) &&
      isOwnerRole(item.qualite),
  );
  const siren = entity?.siren?.replace(/\s/g, "") ?? "";
  return /^\d{9}$/.test(siren) ? siren : null;
}

/**
 * `code_postal` / `departement` filtrent les ÉTABLISSEMENTS, pas le siège :
 * une entreprise remonte dès qu'une de ses antennes matche. On affiche donc le
 * site trouvé (et non le siège, souvent à l'autre bout de la France), et on
 * écarte les résultats dont le seul établissement local est fermé.
 */
function mapResult(raw: GouvResult, geoFiltered: boolean): CompanyBase | null {
  // « GLOBAL 2F (GLOBAL 2F) » : le sigle qui répète le nom est retiré.
  const name = singleCompanyName(raw.nom_complet ?? raw.nom_raison_sociale);
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
    leader_person: physicalLeader(raw.dirigeants),
    parent_company: parentCompany(raw.dirigeants),
    matched_branch: Boolean(site && site.est_siege === false),
    figures: {
      // Date complete : elle seule permet un age exact (cf. companyAge).
      founded_on: raw.date_creation ?? null,
      effectif_code: raw.tranche_effectif_salarie ?? null,
      parent_company_siren: parentCompanySiren(raw.dirigeants),
      legal_code: raw.nature_juridique ?? null,
      company_category: raw.categorie_entreprise ?? null,
      head_office_city: headOffice !== city ? headOffice : null,
      diffusion: raw.statut_diffusion ?? null,
      administrative_state: raw.etat_administratif ?? null,
      ...latestFinance(raw.finances),
    },
  };
}

/**
 * Plafond dur de l'annuaire : au-dela, `total_results` reste bloque a 10 000 et
 * les pages profondes sont refusees. C'est ce chiffre qui s'affichait tel quel
 * dans l'UI (« sur 10000 entreprises »), en donnant l'illusion d'un comptage.
 */
export const ANNUAIRE_RESULT_CAP = 10_000;

/** Nombre de pages reellement atteignables pour un total et une taille de page. */
export function pageCount(total: number, perPage: number): number {
  const reachable = Math.min(total, ANNUAIRE_RESULT_CAP);
  return Math.max(1, Math.ceil(reachable / Math.max(1, perPage)));
}

export interface SearchPage {
  companies: CompanyBase[];
  total: number;
  /** `true` quand le total est plafonne par l'API et n'est donc pas exact. */
  capped: boolean;
  /** Page effectivement demandee. */
  page: number;
  pages: number;
  /** Libelle de la zone resolue, a afficher a cote du total. */
  zoneLabel: string | null;
}

export interface SearchOptions {
  perPage?: number;
  page?: number;
  /** Zone deja resolue par `resolveZone` — la seule source de filtre geo. */
  zone?: ResolvedZone | null;
}

/** Parametres envoyes a l'annuaire. Exporte pour etre verifiable en test. */
export function buildSearchParams(
  criteria: SearchCriteria,
  options: SearchOptions = {},
): { params: URLSearchParams; geoFiltered: boolean } | { error: string } {
  const perPage = Math.max(1, Math.min(25, options.perPage ?? 12));
  const params = new URLSearchParams({
    page: String(Math.max(1, options.page ?? 1)),
    per_page: String(perPage),
    etat_administratif: "A", // entreprises en activité uniquement
  });

  if (criteria.q?.trim()) params.set("q", criteria.q.trim());
  if (criteria.section) params.set("section_activite_principale", criteria.section);
  if (criteria.tranches?.length) {
    params.set("tranche_effectif_salarie", criteria.tranches.join(","));
  }

  // La zone n'entre JAMAIS dans `q` : ce sont deux choses differentes, et les
  // confondre faisait remonter des entreprises dont le nom contient « Paris ».
  const geoFiltered = Boolean(options.zone);
  if (options.zone) params.set(options.zone.param, options.zone.value);

  // L'API exige au moins un critère : sans rien, on renverrait l'annuaire entier.
  const structural = ["page", "per_page", "etat_administratif"];
  if (![...params.keys()].some((key) => !structural.includes(key))) {
    return { error: "Renseignez au moins un critère (secteur, taille ou zone)." };
  }
  return { params, geoFiltered };
}

export async function searchCompanies(
  criteria: SearchCriteria,
  perPage = 12,
  options: SearchOptions = {},
): Promise<Result<SearchPage>> {
  const built = buildSearchParams(criteria, { ...options, perPage });
  if ("error" in built) return { ok: false, error: built.error };

  // Une page d'annuaire ne bouge pas dans la journée : la mettre en cache 24 h
  // supprime la quasi-totalité du trafic répété d'un scan à l'autre, et donc
  // l'essentiel du risque de 429.
  const key = `gouv:search:${built.params.toString()}`;
  const data = await cached<GouvResponse>(key, async () => {
    const outcome = await limitedFetch(`${BASE_URL}?${built.params}`, {
      key: "annuaire",
      ratePerSecond: ANNUAIRE_RATE_PER_SECOND,
      attempts: 3,
      init: { headers: { Accept: "application/json" } },
      onRetry: (message) => console.warn(message),
    });
    if (!outcome.response?.ok) return null;
    return (await outcome.response.json()) as GouvResponse;
  }, ONE_DAY_MS);

  if (!data) {
    return {
      ok: false,
      error:
        "annuaire momentanément saturé (429) : réessayez dans quelques secondes, " +
        "le débit est déjà limité côté serveur",
    };
  }
  const response = { ok: true as const, data };

  const companies = (response.data.results ?? [])
    .map((raw) => mapResult(raw, built.geoFiltered))
    .filter((company): company is CompanyBase => company !== null);

  const total = response.data.total_results ?? companies.length;
  return {
    ok: true,
    data: {
      companies,
      total,
      capped: total >= ANNUAIRE_RESULT_CAP,
      page: Number(built.params.get("page")) || 1,
      pages: pageCount(total, perPage),
      zoneLabel: options.zone?.label ?? null,
    },
  };
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
