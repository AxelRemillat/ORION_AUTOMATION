import { runContactSearch, type ContactDeps } from "./finder";
import { toDomain } from "./domains";
import type { CompanyIdentity, ContactBudget } from "./types";

/**
 * SITE TROUVÉ GRATUITEMENT — avant toute rédaction et avant les appels payants.
 *
 * Décision Cowork (itération 2, 04/10/2026) : 5 fiches sur 10 n'avaient aucun
 * site connu, donc aucun fait propre, donc pas de mail. On cherche le site par
 * la seule chaîne GRATUITE : domaines déduits de la raison sociale et de
 * l'enseigne, chacun validé par la même inspection que la recherche de contact
 * (accueil, mentions légales, SIREN ou nom). Ni Linkup, ni Hunter, ni modèle.
 * Pas de site validé : `null` — jamais un domaine deviné.
 */

/** Rien de payant : seules les lectures de pages (requêtes HTTP) sont permises. */
export const FREE_BUDGET: ContactBudget = { linkup: 0, pages: 4, llm: 0, hunterDomainSearch: 0, hunterFinder: 0, hunterVerifier: 0 };
export const MAX_CANDIDATE_DOMAINS = 8;

const LEGAL_FORMS = /\b(sarl|sas|sasu|eurl|sa|sci|snc|selarl|scop|ets|etablissements?|societe|ste|groupe|holding)\b/g;
const STOP = new Set(["et", "de", "des", "du", "la", "le", "les", "l", "d", "en", "a", "au", "aux", "and"]);

const tokens = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " et ")
    .replace(LEGAL_FORMS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !STOP.has(word));

/**
 * Domaines plausibles d'un nom, du plus probable au moins probable :
 * « ACTUEL VERANDA ET MENUISERIE » → actuel-veranda.fr, actuelveranda.fr,
 * actuel-veranda.com, …, actuel-veranda-menuiserie.fr… Code pur.
 */
export function candidateDomains(names: readonly (string | null | undefined)[], city?: string | null): string[] {
  const out: string[] = [];
  const push = (label: string) => {
    if (label.length < 3 || label.length > 40) return;
    for (const tld of ["fr", "com"]) {
      const domain = `${label}.${tld}`;
      if (!out.includes(domain)) out.push(domain);
    }
  };
  const place = tokens(city ?? "").join("-");
  for (const name of names) {
    // « C.T.A. » : des lettres isolées forment un sigle, « cta » — repéré sur le
    // nom BRUT (« a » serait sinon retiré comme mot vide).
    const acronym = /^\s*([a-z]\s*[.\s]\s*){2,}[a-z]?\.?\s*$/i.test(name ?? "") ? (name ?? "").replace(/[^a-z]/gi, "").toLowerCase() : null;
    const raw = tokens(name ?? "");
    const words = acronym ? [acronym] : raw.filter((word) => word.length > 1);
    if (!words.length) continue;
    const two = words.slice(0, 2);
    if (two.length === 2) {
      push(two.join("-"));
      push(two.join(""));
    }
    push(words.slice(0, 3).join("-"));
    if (words[0].length >= 3) push(words[0]);
    if (place) push(`${words.slice(0, 2).join("-")}-${place}`);
  }
  return out.slice(0, MAX_CANDIDATE_DOMAINS * 2);
}

export interface FreeSite {
  website: string;
  domain: string;
  confidence: number;
}

export async function findSiteFree(
  company: Omit<CompanyIdentity, "knownWebsite" | "pappersWebsite" | "knownEmail">,
  deps: ContactDeps,
  options: { deadline?: number } = {},
): Promise<FreeSite | null> {
  // Les recherches web et Hunter ne sont JAMAIS appelées : budget à zéro, et
  // les dépendances payantes sont neutralisées par sécurité.
  const freeDeps: ContactDeps = {
    fetchHtml: deps.fetchHtml,
    webSearch: async () => null,
    hunterDomainSearch: async () => null,
    hunterFinder: async () => null,
    hunterVerify: async () => null,
  };
  const domains = candidateDomains([...company.tradeNames, company.legalName], company.city).slice(0, MAX_CANDIDATE_DOMAINS);
  for (const domain of domains) {
    if (options.deadline && Date.now() > options.deadline) break;
    const { result } = await runContactSearch(
      { ...company, knownWebsite: `https://${domain}`, pappersWebsite: null, knownEmail: null },
      freeDeps,
      FREE_BUDGET,
      { hunter: { allowed: false, reason: "recherche de site seule (gratuite)" } },
    ).catch(() => ({ result: null }));
    const found = result?.website ? toDomain(result.website) : null;
    if (result?.website && found) return { website: result.website, domain: found, confidence: result.confidence };
  }
  return null;
}

/** Identité minimale, SANS appel Pappers : nom, enseignes, SIREN, ville. */
export function siteIdentity(input: {
  id?: string | null;
  name: string;
  tradeNames?: readonly (string | null | undefined)[];
  siren?: string | null;
  city?: string | null;
  postalCode?: string | null;
}): Omit<CompanyIdentity, "knownWebsite" | "pappersWebsite" | "knownEmail"> {
  return {
    prospectId: input.id ?? null,
    legalName: input.name,
    tradeNames: (input.tradeNames ?? []).filter((name): name is string => Boolean(name && name.trim() && name !== input.name)),
    siren: input.siren?.replace(/\s/g, "") || null,
    city: input.city ?? null,
    postalCode: input.postalCode ?? null,
    leader: null,
    activity: null,
  };
}
