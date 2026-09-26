import type { ProspectSignal } from "@/types";

/**
 * Anti-homonymie : à quelle entité un texte web se rapporte-t-il vraiment ?
 *
 * Cas d'origine : l'évaluation a produit « Jacquet Metal Service » dans un
 * mail destiné à JACQUET PARIS, un autre SIREN. Un nom PROCHE avait suffi à
 * rattacher un signal au prospect.
 *
 * Règle : un signal ou un fait web n'est rattaché au prospect que s'il porte
 *   - son SIREN, ou
 *   - une URL sur son domaine vérifié, ou
 *   - sa dénomination EXACTE (au mot près, forme juridique mise à part).
 *
 * Un nom proche ne suffit pas. Si l'entité voisine est liée au prospect par un
 * lien capitalistique PROUVÉ (représentant au registre, groupe parent avec
 * citation), le signal parle du GROUPE et devient un fait de groupe. Sinon il
 * est écarté avec la raison « homonyme probable ».
 *
 * Module pur, sans dépendance : importable partout, testable sans réseau.
 */

/** Au-delà, la décision d'achat se prend au niveau du groupe, pas sur place. */
export const LARGE_GROUP_REVENUE_EUR = 50_000_000;
export const LARGE_GROUP_HEADCOUNT = 250;

const LEGAL_FORMS = new Set([
  "sas", "sasu", "sarl", "eurl", "sa", "snc", "scop", "sci", "selarl", "sca", "scs", "sem",
]);

interface Token {
  raw: string;
  norm: string;
  start: number;
  end: number;
}

const normalizeWord = (word: string): string =>
  word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}&]+/gu)) {
    const start = match.index ?? 0;
    tokens.push({ raw: match[0], norm: normalizeWord(match[0]), start, end: start + match[0].length });
  }
  return tokens;
}

/** Mots de la dénomination, forme juridique retirée. */
export function denominationWords(name: string): string[] {
  return tokenize(name)
    .map((token) => token.norm)
    .filter((word) => !LEGAL_FORMS.has(word));
}

/** « Metal » prolonge un nom ; « recrute » ou « ACTUALITÉ » non. */
const isCapitalized = (raw: string): boolean =>
  /^\p{Lu}/u.test(raw) && /\p{Ll}/u.test(raw.slice(1));

/** Séparateur qui laisse un nom se prolonger : espace ou trait d'union seuls. */
const continuesName = (between: string): boolean => /^[\s\-–]*$/.test(between) && between.length > 0;

interface Occurrence {
  start: number;
  end: number;
  /** Mots en majuscule initiale qui suivent immédiatement, s'il y en a. */
  extension: string[];
}

function occurrences(text: string, words: string[]): Occurrence[] {
  if (!words.length) return [];
  const tokens = tokenize(text);
  const found: Occurrence[] = [];
  for (let i = 0; i + words.length <= tokens.length; i += 1) {
    if (!words.every((word, k) => tokens[i + k].norm === word)) continue;
    const last = i + words.length - 1;
    const extension: string[] = [];
    for (let j = last + 1; j < tokens.length && extension.length < 4; j += 1) {
      const between = text.slice(tokens[j - 1].end, tokens[j].start);
      if (!continuesName(between) || !isCapitalized(tokens[j].raw)) break;
      if (LEGAL_FORMS.has(tokens[j].norm)) break;
      extension.push(tokens[j].raw);
    }
    found.push({ start: tokens[i].start, end: tokens[last].end, extension });
  }
  return found;
}

/**
 * La dénomination apparaît-elle TELLE QUELLE ?
 *
 * « Jacquet Paris recrute » : oui. « Jacquet Metal Service recrute » pour
 * JACQUET : non — le nom continue, c'est une autre entité.
 */
export function mentionsExactDenomination(text: string, name: string): boolean {
  return occurrences(text, denominationWords(name)).some((item) => item.extension.length === 0);
}

/** Mot distinctif de la dénomination : le premier d'au moins 4 lettres. */
function headWord(name: string): string | null {
  return denominationWords(name).find((word) => word.length >= 4) ?? null;
}

/**
 * Nom d'une entité VOISINE mentionnée dans le texte : même mot distinctif,
 * mais dénomination différente. `null` si le texte n'en contient pas.
 */
export function nearbyEntity(text: string, name: string): string | null {
  const head = headWord(name);
  if (!head) return null;
  const target = denominationWords(name).join(" ");
  const tokens = tokenize(text);

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].norm !== head) continue;
    const words = [tokens[i]];
    for (let j = i + 1; j < tokens.length && words.length < 5; j += 1) {
      const between = text.slice(tokens[j - 1].end, tokens[j].start);
      if (!continuesName(between) || !isCapitalized(tokens[j].raw) || LEGAL_FORMS.has(tokens[j].norm)) break;
      words.push(tokens[j]);
    }
    const candidate = words.map((token) => token.norm).join(" ");
    if (candidate !== target) return words.map((token) => token.raw).join(" ");
  }
  return null;
}

const sameEntity = (a: string, b: string): boolean => {
  const left = denominationWords(a).join(" ");
  const right = denominationWords(b).join(" ");
  return Boolean(left && right) && (left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `));
};

export interface EntityTarget {
  name: string;
  siren?: string | null;
  /** Domaine VÉRIFIÉ du prospect (site lu ou trouvé), sinon null. */
  website?: string | null;
}

/** Liens capitalistiques prouvés, tels que l'enrichissement les a établis. */
export interface CapitalLinks {
  /** Représentant personne morale au registre (Pappers). */
  parentCompany?: string | null;
  /** Groupe parent issu de l'extraction web — accepté seulement avec citation. */
  parentGroup?: string | null;
  parentGroupQuote?: string | null;
}

export type Attachment =
  | { kind: "prospect"; basis: "siren" | "domaine" | "dénomination exacte" }
  | { kind: "parent"; entity: string; basis: "registre" | "groupe cité" }
  | { kind: "rejected"; reason: "homonyme probable"; entity: string }
  | { kind: "rejected"; reason: "non rattaché" };

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Une entité voisine est-elle le groupe du prospect, preuve à l'appui ? */
function provenParent(entity: string, links: CapitalLinks): Attachment | null {
  if (links.parentCompany && sameEntity(entity, links.parentCompany)) {
    return { kind: "parent", entity, basis: "registre" };
  }
  if (links.parentGroup && links.parentGroupQuote && sameEntity(entity, links.parentGroup)) {
    return { kind: "parent", entity, basis: "groupe cité" };
  }
  return null;
}

/**
 * Verdict de rattachement d'un texte web (citation, libellé) et de son URL.
 *
 * `trustAnchoredDocument` : l'extraction structurée a déjà vérifié l'ancrage
 * du DOCUMENT (SIREN, domaine ou dénomination + second identifiant). Sa
 * citation n'a pas à renommer l'entreprise — mais si elle nomme une entité
 * voisine, c'est elle qu'elle décrit.
 */
export function attachMention(
  mention: { text: string; url?: string | null },
  target: EntityTarget,
  links: CapitalLinks = {},
  options: { trustAnchoredDocument?: boolean } = {},
): Attachment {
  const digits = mention.text.replace(/[\s.]/g, "");
  if (target.siren && target.siren.length === 9 && digits.includes(target.siren)) {
    return { kind: "prospect", basis: "siren" };
  }

  const domain = hostOf(target.website);
  const host = hostOf(mention.url);
  if (domain && host && (host === domain || host.endsWith(`.${domain}`))) {
    return { kind: "prospect", basis: "domaine" };
  }

  if (mentionsExactDenomination(mention.text, target.name)) {
    return { kind: "prospect", basis: "dénomination exacte" };
  }

  const entity = nearbyEntity(mention.text, target.name);
  if (entity) return provenParent(entity, links) ?? { kind: "rejected", reason: "homonyme probable", entity };

  return options.trustAnchoredDocument
    ? { kind: "prospect", basis: "dénomination exacte" }
    : { kind: "rejected", reason: "non rattaché" };
}

export interface RejectedSignal {
  label: string;
  url?: string;
  reason: "homonyme probable" | "non rattaché";
  entity: string | null;
}

export interface SignalAttachment {
  /** Signaux du prospect, et signaux de groupe marqués `scope: "groupe"`. */
  kept: ProspectSignal[];
  rejected: RejectedSignal[];
  /** Entités voisines écartées : leur nom ne doit jamais apparaître dans un mail. */
  foreignEntities: string[];
}

/**
 * Trie une liste de signaux selon la règle de rattachement.
 *
 * Les signaux déduits (sans citation ni URL) ne décrivent aucune entité web :
 * ils passent tels quels.
 */
/**
 * Sources dont le rattachement est etabli par le SIREN, pas par le texte.
 *
 * Le greffe et France Travail publient une annonce POUR un SIREN : il n'y a
 * pas d'homonymie possible, et leur libelle n'a aucune raison de nommer
 * l'entreprise.
 */
const OFFICIAL_SOURCES = new Set(["BODACC", "France Travail", "La Bonne Boite"]);

export function attachSignals(
  signals: readonly ProspectSignal[],
  target: EntityTarget,
  links: CapitalLinks = {},
): SignalAttachment {
  const kept: ProspectSignal[] = [];
  const rejected: RejectedSignal[] = [];
  const foreign = new Set<string>();

  for (const signal of signals) {
    const quote = typeof signal.quote === "string" ? signal.quote : "";
    if (!quote && !signal.url) {
      kept.push(signal);
      continue;
    }
    // Une annonce officielle est rattachee par le SIREN de l'annonce : c'est le
    // rattachement le plus fort qui existe, plus fort qu'une citation nominative.
    //
    // Sans cette exception, la regle d'ancrage — ecrite pour les resultats web —
    // ecartait TOUS les signaux BODACC : leur citation est le libelle du greffe
    // (« Modification du capital »), qui ne nomme pas l'entreprise. Constate sur
    // SUN'R GROUPE et L'ARBRE A SOUHAITS le 26/09/2026 : signal trouve, date,
    // vrai, et jete a la redaction.
    if (signal.dateBasis === "source" && typeof signal.source === "string" && OFFICIAL_SOURCES.has(signal.source)) {
      kept.push(signal);
      continue;
    }
    const verdict = attachMention(
      { text: `${signal.label ?? ""}\n${quote}`, url: signal.url },
      target,
      links,
      { trustAnchoredDocument: signal.structured === true },
    );
    if (verdict.kind === "prospect") kept.push(signal);
    else if (verdict.kind === "parent") kept.push({ ...signal, scope: "groupe", entity: verdict.entity });
    else {
      const entity = verdict.reason === "homonyme probable" ? verdict.entity : null;
      if (entity) foreign.add(entity);
      rejected.push({ label: signal.label, url: signal.url, reason: verdict.reason, entity });
    }
  }
  return { kept, rejected, foreignEntities: [...foreign] };
}

/** Taille qui fait d'un groupe un « grand groupe » : > 250 salariés ou > 50 M€. */
export function isLargeGroup(size: { headcount?: number | null; revenueEur?: number | null }): boolean {
  return (
    (size.headcount != null && size.headcount > LARGE_GROUP_HEADCOUNT) ||
    (size.revenueEur != null && size.revenueEur > LARGE_GROUP_REVENUE_EUR)
  );
}

/**
 * Nom d'entreprise tel qu'il s'écrit dans un mail.
 *
 * La dénomination du registre fait foi. Si une source rattachée (site,
 * citation) l'écrit en casse mixte — « Blue EnerFreeze » —, c'est l'enseigne
 * confirmée et on la reprend. Sinon, casse naturelle calculée : BLUE
 * ENERFREEZE → Blue Enerfreeze. Jamais le nom d'une autre entité.
 */
export function displayCompanyName(registryName: string, confirmedTexts: readonly string[] = []): string {
  const words = denominationWords(registryName);
  for (const text of confirmedTexts) {
    for (const item of occurrences(text, words)) {
      const raw = text.slice(item.start, item.end);
      if (item.extension.length === 0 && raw !== raw.toUpperCase() && raw !== raw.toLowerCase()) return raw;
    }
  }
  return naturalCase(registryName);
}

const LOWER_WORDS = new Set(["de", "du", "des", "la", "le", "les", "et", "en", "sur", "aux", "au", "d", "l"]);

/** Casse naturelle d'une dénomination en capitales ; inchangée si déjà mixte. */
export function naturalCase(name: string): string {
  const tokens = tokenize(name).filter((token) => !LEGAL_FORMS.has(token.norm));
  if (!tokens.length) return name.trim();
  const raw = tokens.map((token) => token.raw).join(" ");
  if (raw !== raw.toUpperCase()) return name.replace(/\s+(SAS|SASU|SARL|EURL|SA|SNC)\s*$/, "").trim();

  const cased = tokens.map((token, index) => {
    const lower = token.raw.toLowerCase();
    if (index > 0 && LOWER_WORDS.has(lower)) return lower;
    // Sigle court sans voyelle (« SNCF » exclu, trop long) : on le garde.
    if (token.raw.length <= 3 && !/[AEIOUY]/.test(token.raw)) return token.raw;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });

  // Les separateurs d'origine sont CONSERVES : le tokeniseur ignore
  // l'apostrophe, et joindre par des espaces ecrivait « L ARBRE A SOUHAITS »
  // en « L Arbre A Souhaits » — vu dans un mail reel le 26/09/2026. Une
  // apostrophe ou un trait d'union se recolle sans espace.
  let out = cased[0];
  for (let index = 1; index < tokens.length; index += 1) {
    const between = name.slice(tokens[index - 1].end, tokens[index].start);
    const glue = /['’-]/.test(between) ? between.replace(/\s+/g, "") : " ";
    out += glue + cased[index];
  }
  return out;
}
