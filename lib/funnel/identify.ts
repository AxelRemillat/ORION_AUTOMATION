import { searchCompanies } from "@/lib/enrichment/gouv";
import type { CompanyBase } from "@/lib/enrichment/types";
import { normalizeCity, simplifyName } from "@/lib/signals";
import type { HarvestedSignal, Identity } from "./types";

/**
 * Identité gratuite d'un signal (API Recherche d'entreprises).
 *
 * BODACC donne le SIREN : il fait foi. Une offre d'emploi n'en a pas : on
 * cherche le nom dans le département de l'offre, et on n'accepte que un nom
 * qui correspond vraiment (l'annuaire répond de façon floue).
 */

/**
 * Résultat d'une recherche d'identité.
 *
 * « Introuvable » et « annuaire saturé » ne veulent pas dire la même chose, et
 * les confondre coûte des prospects : le 28/09/2026, 19 signaux du run 69+31
 * étaient comptés « entreprise introuvable à l'annuaire » alors que l'API
 * répondait 429 — le limiteur avait épuisé ses trois essais. Un signal perdu
 * pour cause de saturation doit être rejouable, pas classé faux.
 */
export type LookupOutcome =
  | { ok: true; company: CompanyBase | null }
  | { ok: false; reason: "annuaire saturé" };

export type Lookup = (signal: HarvestedSignal) => Promise<LookupOutcome>;

const departementOf = (postalCode: string | null | undefined) => {
  if (!postalCode) return null;
  return postalCode.startsWith("97") ? postalCode.slice(0, 3) : postalCode.slice(0, 2);
};

const sameName = (left: string, right: string) => {
  const a = simplifyName(left);
  const b = simplifyName(right);
  return Boolean(a && b) && (a.includes(b) || b.includes(a));
};

/** Recherche annuaire réelle, avec le limiteur de débit de lib/enrichment. */
export const annuaireLookup: Lookup = async (signal) => {
  const found = await findCompany(signal);
  if (!found.ok || !found.company) return found;
  return { ok: true, company: await withParent(found.company) };
};

async function findCompany(signal: HarvestedSignal): Promise<LookupOutcome> {
  if (signal.siren) {
    const page = await searchCompanies({ q: signal.siren }, 1);
    if (!page.ok) return saturated(page.error);
    return { ok: true, company: page.data.companies.find((company) => company.siren === signal.siren) ?? null };
  }
  const departement = departementOf(signal.facts.postalCode);
  const zone = departement
    ? { kind: "departement" as const, label: `département ${departement}`, param: "departement" as const, value: departement, departement }
    : undefined;
  const page = await searchCompanies({ q: signal.companyName }, 3, zone ? { zone } : {});
  if (!page.ok) return saturated(page.error);
  const loose = page.data.companies.find((company) => sameName(signal.companyName, company.company_name));
  if (loose) return { ok: true, company: loose };
  const commune = await communeLookup(signal);
  // Commune muette : on élargit à la France entière, sous la règle stricte.
  if (!commune.ok || commune.company) return commune;
  return nationalLookup(signal);
}

/**
 * REPLI « nom + commune » quand la recherche par département n'a rien donné.
 *
 * Run 3 (05/10/2026) : 98 offres France Travail rejetées « introuvables à
 * l'annuaire » — le nom publié n'était pas dans les 3 premiers résultats du
 * département. On relance, gratuitement, sur le code postal de l'offre avec
 * 10 résultats, et on n'accepte qu'une correspondance UNIQUE et NETTE : nom
 * normalisé identique ET établissement dans la même commune. Deux candidats
 * ou aucun : on rejette, on ne devine pas.
 */
export async function communeLookup(
  signal: HarvestedSignal,
  search: typeof searchCompanies = searchCompanies,
): Promise<LookupOutcome> {
  const postalCode = signal.facts.postalCode?.trim();
  const city = normalizeCity(signal.facts.city);
  if (!postalCode || !/^\d{5}$/.test(postalCode) || !city) return { ok: true, company: null };
  const zone = { kind: "code_postal" as const, label: postalCode, param: "code_postal" as const, value: postalCode, departement: departementOf(postalCode) };
  // Le nom publié peut porter la commune en suffixe : on interroge la forme
  // nettoyée, et on accepte les deux formes à la comparaison.
  const stripped = stripTrailingCity(signal.companyName, signal.facts.city);
  const page = await search({ q: stripped }, 10, { zone });
  if (!page.ok) return saturated(page.error);
  const match =
    uniqueMatch(signal.companyName, city, page.data.companies) ??
    uniqueMatch(stripped, city, page.data.companies);
  return { ok: true, company: match };
}

/**
 * ENSEIGNES ET RÉSEAUX — jamais rattrapés à l'échelle de la France.
 *
 * Un nom d'enseigne désigne des centaines d'établissements juridiquement
 * distincts : « unique à l'échelle nationale » n'y voudrait rien dire, et la
 * première correspondance serait un hasard. On préfère « introuvable » à une
 * fiche prise au hasard dans un réseau — c'est tout l'objet du rattrapage de
 * ne JAMAIS deviner.
 *
 * Liste de MARQUES, volontairement : les mots génériques (« groupement »,
 * « réseau », « union ») écarteraient GROUPEMENT FRANCE DEFI, qui est une
 * entreprise unique et l'un des cas à rattraper.
 */
export const CHAIN_NAMES: readonly string[] = [
  "mousquetaires",
  "intermarche",
  "bricomarche",
  "brico cash",
  "netto",
  "roady",
  "cerfrance",
  "leclerc",
  "super u",
  "hyper u",
  "u express",
  "utile",
  "carrefour",
  "casino",
  "lidl",
  "aldi",
  "franprix",
  "monoprix",
  "intersport",
  "decathlon",
  "point p",
  "gedimat",
  "weldom",
  "mr bricolage",
  "gamm vert",
  "point vert",
  "credit agricole",
  "credit mutuel",
  "banque populaire",
  "caisse d epargne",
  "la poste",
  "orange",
  "mcdonald",
  "burger king",
  "subway",
];

/** Vrai si le nom porte une enseigne connue : on ne le rattrape pas. */
export function isChainName(name: string): boolean {
  const simple = simplifyName(name);
  if (!simple) return false;
  return CHAIN_NAMES.some((chain) => simple === chain || simple.startsWith(`${chain} `) || simple.endsWith(` ${chain}`) || simple.includes(` ${chain} `));
}

/**
 * Retire la commune collée en fin de raison sociale.
 *
 * L'annuaire publie « COMPTOIR ACCESSOIRES AUTOS » et l'offre d'emploi
 * « COMPTOIR ACCESSOIRES AUTOS LIBERCOURT » : le suffixe est la ville de
 * l'établissement, pas le nom. Rendu tel quel, il fait échouer la comparaison
 * stricte. On ne retire que ce suffixe, et seulement s'il reste un nom digne
 * de ce nom — deux mots, cinq caractères — sinon on garde l'original.
 */
export function stripTrailingCity(name: string, city: string | null | undefined): string {
  const simpleCity = normalizeCity(city);
  if (!simpleCity) return name;
  const simple = simplifyName(name);
  const suffix = ` ${simplifyName(simpleCity)}`;
  if (!simple.endsWith(suffix)) return name;
  const kept = simple.slice(0, -suffix.length).trim();
  if (kept.split(" ").length < 2 || kept.length < 5) return name;
  return kept;
}

/**
 * RATTRAPAGE NATIONAL — le dernier recours, et le plus strict.
 *
 * Quand ni le département ni la commune n'ont rien donné, on cherche dans
 * toute la France. Le prix de cette largeur, c'est une exigence absolue :
 * UN SEUL résultat, dont le nom normalisé est IDENTIQUE au nom cherché — pas
 * « contient », pas « commence par ». Deux candidats, ou un nom seulement
 * ressemblant : introuvable. Une enseigne : introuvable, sans même chercher.
 */
export async function nationalLookup(
  signal: HarvestedSignal,
  search: typeof searchCompanies = searchCompanies,
): Promise<LookupOutcome> {
  const raw = signal.companyName?.trim();
  if (!raw) return { ok: true, company: null };
  if (isChainName(raw)) return { ok: true, company: null };

  const stripped = stripTrailingCity(raw, signal.facts.city);
  const page = await search({ q: stripped }, 10);
  if (!page.ok) return saturated(page.error);
  return { ok: true, company: uniqueNationalMatch([raw, stripped], page.data.companies) };
}

/**
 * La seule fiche dont le nom normalisé est identique à l'une des formes
 * cherchées (nom publié, ou nom sans la commune en suffixe). Les
 * établissements d'une même entreprise partagent son SIREN : ils ne comptent
 * que pour une.
 */
export function uniqueNationalMatch(forms: readonly string[], companies: readonly CompanyBase[]): CompanyBase | null {
  const wanted = new Set(forms.map((form) => simplifyName(form)).filter(Boolean));
  if (!wanted.size) return null;
  const matches = new Map<string, CompanyBase>();
  for (const company of companies) {
    if (!wanted.has(simplifyName(company.company_name))) continue;
    matches.set(company.siren ?? company.company_name, company);
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

/** La seule fiche dont le nom normalisé est IDENTIQUE et la commune la même, sinon `null`. */
export function uniqueMatch(name: string, city: string, companies: readonly CompanyBase[]): CompanyBase | null {
  const wanted = simplifyName(name);
  if (!wanted) return null;
  const matches = new Map<string, CompanyBase>();
  for (const company of companies) {
    if (simplifyName(company.company_name) !== wanted) continue;
    if (normalizeCity(company.city) !== city) continue;
    matches.set(company.siren ?? company.company_name, company);
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

/**
 * Tête de groupe, lue GRATUITEMENT : quand l'annuaire publie un dirigeant
 * personne morale, on lit sa fiche (catégorie, tranche d'effectif). Sert à
 * exclure les filiales de groupes de 250 salariés et plus AVANT toute dépense.
 */
export async function withParent(
  company: CompanyBase,
  search: typeof searchCompanies = searchCompanies,
): Promise<CompanyBase> {
  const siren = company.figures.parent_company_siren;
  if (typeof siren !== "string" || !siren || siren === company.siren) return company;
  const page = await search({ q: siren }, 1);
  const parent = page.ok ? page.data.companies.find((item) => item.siren === siren) : undefined;
  if (!parent) return company;
  return {
    ...company,
    figures: {
      ...company.figures,
      parent_company_name: parent.company_name,
      parent_company_category: parent.figures.company_category ?? null,
      parent_effectif_code: parent.figures.effectif_code ?? null,
    },
  };
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Une erreur de transport n'est pas une absence d'entreprise.
 *
 * Le limiteur (lib/enrichment/rate-limit.ts) attend déjà et rejoue sur 429 ;
 * quand il abandonne, c'est que l'annuaire est saturé pour de bon. On le DIT,
 * au lieu de le confondre avec « pas trouvée ».
 */
function saturated(error: string): LookupOutcome {
  console.warn(`[entonnoir] annuaire indisponible : ${error}`);
  return { ok: false, reason: "annuaire saturé" };
}

/** Identité du filtre, à partir d'une fiche annuaire. */
export function toIdentity(signal: HarvestedSignal, base: CompanyBase): Identity {
  const figures = base.figures;
  // Établissement secondaire : la ville du signal n'est pas celle du siège.
  const headOffice = figures.head_office_city ?? base.city;
  const signalCity = normalizeCity(signal.facts.city);
  const isBranch =
    base.matched_branch || Boolean(signalCity && headOffice && normalizeCity(headOffice) !== signalCity);

  return {
    siren: base.siren ?? signal.siren ?? "",
    name: base.company_name,
    naf: base.naf_code,
    effectifCode: figures.effectif_code,
    diffusion: figures.diffusion ?? null,
    adminState: figures.administrative_state ?? null,
    createdOn: figures.founded_on,
    legalCode: figures.legal_code,
    isBranch,
    headOfficeCity: isBranch ? headOffice : null,
    city: base.city,
    revenue: figures.revenue_eur,
    revenueYear: figures.revenue_year,
    // Une offre n'est « confirmée » que si l'annuaire a trouvé l'employeur.
    employerConfirmed: signal.source !== "france-travail" || sameName(signal.companyName, base.company_name),
    category: text(figures.company_category),
    parentName: text(figures.parent_company_name) ?? base.parent_company ?? null,
    parentCategory: text(figures.parent_company_category),
    parentEffectifCode: text(figures.parent_effectif_code),
  };
}
