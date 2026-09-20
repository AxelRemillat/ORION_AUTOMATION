/**
 * Qualification des signaux — sur PREUVE uniquement.
 *
 * Regle unique : un signal n'est emis que si une source nomme l'entreprise et
 * atteste l'evenement noir sur blanc. La phrase qui le prouve est conservee
 * (`quote`) avec son URL, sa date et un indice de confiance.
 *
 * Ce module a ete durci apres un incident : des entreprises n'ayant jamais
 * leve de fonds etaient taguees « Levee de fonds ». Deux causes cumulees — une
 * requete Linkup qui enumerait elle-meme les evenements cherches, et une
 * qualification qui se contentait de chercher le mot-cle n'importe ou dans le
 * resultat, sans verifier qu'il concernait bien cette entreprise. Les deux
 * garde-fous ci-dessous (ancrage sur l'entreprise + seuil de confiance) sont
 * la pour que cela ne puisse pas se reproduire.
 *
 * Purement deterministe : aucun appel LLM sur le chemin de la recherche.
 */
import type { ProspectSignal } from "@/types";
import { effectifFloor } from "./naf";
import { toDomain } from "./http";
import type { CompanyBase } from "./types";
import type { WebResult } from "./linkup";

interface Rule {
  type: string;
  pattern: RegExp;
  /** Ce que la source atteste, formule sobrement. */
  claim: string;
  /**
   * Seuil de confiance. Plus l'affirmation est engageante — et couteuse si
   * elle est fausse — plus il est eleve.
   */
  minConfidence: number;
}

/** Ordre = priorite : un resultat n'est classe que par sa premiere regle. */
const RULES: Rule[] = [
  {
    type: "levee",
    pattern: /lev[ée]e de fonds|l[èe]ve (?:\d|des fonds)|s[ée]rie [ABC]\b|tour de table|fundraising|lev[ée] \d+(?:[.,]\d+)? ?m(?:illions?)?/i,
    claim: "Levée de fonds mentionnée",
    minConfidence: 0.8,
  },
  {
    type: "croissance",
    pattern: /nouvelle agence|ouverture d'un|s'implante|nouveau site de production|a doubl[ée] son|rachat de|acquisition de/i,
    claim: "Développement annoncé",
    minConfidence: 0.75,
  },
  {
    type: "recrutement",
    pattern: /recrute|recrutement|offres? d'emploi|nous recherchons|poste (?:de|d')|CDI\b/i,
    claim: "Recrutement en cours",
    minConfidence: 0.65,
  },
  {
    type: "digital",
    pattern: /refonte (?:du|de) site|nouveau site|digitalisation|transformation num[ée]rique|d[ée]mat[ée]rialisation|d[ée]ploie (?:un|son) (?:ERP|CRM)/i,
    claim: "Chantier digital évoqué",
    minConfidence: 0.7,
  },
  {
    type: "ecommerce",
    pattern: /boutique en ligne|e-?commerce|shopify|prestashop|woocommerce|passer commande en ligne/i,
    claim: "Vente en ligne active",
    minConfidence: 0.65,
  },
  {
    type: "support",
    pattern: /service client|relation client|SAV\b|centre d'appel|standard t[ée]l[ée]phonique/i,
    claim: "Service client exposé",
    minConfidence: 0.65,
  },
];

const MAX_PER_TYPE = 2;
const MAX_SIGNALS = 6;

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Minuscules, sans accents, espaces normalises. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

/**
 * Formes sous lesquelles l'entreprise peut etre nommee : raison sociale
 * complete, et version sans forme juridique ni suffixe generique.
 */
export function companyAliases(name: string): string[] {
  const full = normalize(name);
  const stripped = full
    .replace(/\b(sas|sasu|sarl|eurl|sa|snc|scop|sci|societe|ste|groupe|etablissements?|ets)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliases = new Set([full]);
  if (stripped.length >= 4) aliases.add(stripped);
  return [...aliases];
}

/** Decoupe grossiere en phrases, suffisante pour isoler une citation. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\s*[|•·]\s*|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20);
}

/** Date de publication trouvee dans un texte, au format ISO (AAAA-MM-JJ). */
export function extractDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const fr = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;

  const long = normalize(text).match(
    /\b(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(20\d{2})\b/,
  );
  if (long) {
    const index = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet",
      "aout", "septembre", "octobre", "novembre", "decembre"].indexOf(long[2]);
    if (index >= 0) {
      return `${long[3]}-${String(index + 1).padStart(2, "0")}-${long[1].padStart(2, "0")}`;
    }
  }
  return null;
}

/** Date lisible en francais, a partir d'une date ISO. */
function frenchDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

export interface QualifyTarget {
  name: string;
  website?: string | null;
}

/**
 * Classe les resultats web en signaux PROUVES.
 *
 * Un resultat est retenu seulement si :
 *   1. une phrase declenche une regle d'evenement, ET
 *   2. cette phrase nomme l'entreprise, OU la page est sur son propre domaine.
 * Sans cet ancrage, un article generique sur les levees de fonds suffisait a
 * taguer n'importe qui. La confiance obtenue doit ensuite depasser le seuil
 * de la regle, sinon rien n'est emis — un prospect sans signal reste froid.
 */
export function qualifyWebResults(
  results: WebResult[],
  target: QualifyTarget,
): ProspectSignal[] {
  const aliases = companyAliases(target.name);
  const ownDomain = toDomain(target.website ?? null);
  const counts = new Map<string, number>();
  const signals: ProspectSignal[] = [];

  for (const result of results) {
    if (signals.length >= MAX_SIGNALS) break;

    const host = hostOf(result.url);
    const onOwnSite = Boolean(ownDomain && host.endsWith(ownDomain));
    const namedInTitle = aliases.some((alias) => normalize(result.title).includes(alias));

    // On cherche LA phrase qui prouve, dans le contenu reel de la source.
    const candidates = [...sentences(result.snippet), result.title].filter(Boolean);

    let matched: { rule: Rule; sentence: string; named: boolean } | null = null;
    for (const rule of RULES) {
      const sentence = candidates.find((candidate) => rule.pattern.test(candidate));
      if (!sentence) continue;
      const named = aliases.some((alias) => normalize(sentence).includes(alias));
      // Ancrage obligatoire : la preuve doit concerner CETTE entreprise.
      if (!named && !onOwnSite) continue;
      matched = { rule, sentence, named };
      break;
    }
    if (!matched) continue;

    const { rule, sentence, named } = matched;
    const date = result.date ? extractDate(result.date) : null;
    const foundDate = date ?? extractDate(`${result.title} ${result.snippet}`);

    let confidence = 0;
    if (named) confidence += 0.5;
    // Etre sur le domaine de l'entreprise vaut identification : c'est sa page.
    if (onOwnSite) confidence += 0.5;
    if (namedInTitle) confidence += 0.15;
    if (foundDate) confidence += 0.2;
    if (rule.pattern.test(result.title)) confidence += 0.1;
    confidence = Math.min(1, Number(confidence.toFixed(2)));

    if (confidence < rule.minConfidence) continue;

    const count = counts.get(rule.type) ?? 0;
    if (count >= MAX_PER_TYPE) continue;
    counts.set(rule.type, count + 1);

    signals.push({
      type: rule.type,
      // Le libelle decrit la PREUVE, jamais une promesse commerciale.
      label: `${rule.claim} — ${host}${foundDate ? `, ${frenchDate(foundDate)}` : ""}`,
      url: result.url,
      source: host,
      ...(foundDate ? { date: foundDate } : {}),
      quote: sentence.slice(0, 260),
      confidence,
    });
  }

  return signals;
}

/**
 * Signaux deduits des seules donnees structurelles (INSEE, NAF).
 *
 * Ce ne sont PAS des actualites : ni `quote` ni `url`, et une confiance
 * volontairement moderee. Les ecrans doivent les presenter comme des
 * deductions, jamais comme un evenement recent.
 */
export function structuralSignals(
  company: CompanyBase,
  headcount?: number | null,
): ProspectSignal[] {
  const signals: ProspectSignal[] = [];
  const size = headcount ?? effectifFloor(company.figures.effectif_code);

  if (size != null && size >= 20) {
    signals.push({
      type: "structure",
      label: `Effectif d'au moins ${size} personnes — back-office et reporting à fort volume`,
      source: "Données INSEE",
      confidence: 0.5,
    });
  }
  if (company.naf_section === "G" && company.website) {
    signals.push({
      type: "structure",
      label: "Commerce avec présence web — flux commandes et SAV répétitifs",
      source: "Code NAF",
      confidence: 0.5,
    });
  }
  if (["I", "Q", "H", "N"].includes(company.naf_section ?? "")) {
    signals.push({
      type: "structure",
      label: "Secteur à forte charge de planification et de prise de rendez-vous",
      source: "Code NAF",
      confidence: 0.5,
    });
  }
  const year = company.founded_year;
  if (year && new Date().getFullYear() - year <= 6) {
    signals.push({
      type: "structure",
      label: `Entreprise jeune (créée en ${year}) — outillage interne encore artisanal`,
      source: "Données INSEE",
      confidence: 0.5,
    });
  }

  return signals.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Predicats et deductions utilises par le moteur de recherche en deux phases
// ---------------------------------------------------------------------------

/**
 * Un signal REEL est atteste par une source nommant l'entreprise.
 * Les signaux `structure` sont des deductions INSEE : ils decrivent un contexte
 * favorable, jamais un evenement. Seuls les premiers justifient de depenser un
 * enrichissement profond.
 */
export function isProvenSignal(signal: ProspectSignal): boolean {
  return signal.type !== "structure";
}

export function hasProvenSignal(signals: readonly ProspectSignal[]): boolean {
  return signals.some(isProvenSignal);
}

/** Annuaires et agregateurs : leur domaine ne prouve rien sur l'entreprise. */
const DIRECTORY_HOSTS = [
  "societe.com", "pappers.fr", "infogreffe.fr", "verif.com", "linkedin.com",
  "facebook.com", "youtube.com", "indeed.com", "welcometothejungle.com",
  "bodacc.fr", "manageo.fr", "kompass.com", "google.com", "wikipedia.org",
];

/**
 * Devine le site officiel a partir des resultats du scan.
 *
 * L'annuaire public ne donne pas de site web, et en deux phases le scan tourne
 * AVANT Pappers : sans cette deduction on perdrait l'ancre « la page est sur
 * son propre domaine », qui vaut la moitie de la confiance d'un signal. On ne
 * retient qu'un domaine dont le label porte reellement le nom de l'entreprise.
 */
export function guessOwnWebsite(name: string, results: WebResult[]): string | null {
  const aliases = companyAliases(name)
    .map((alias) => alias.replace(/[^a-z0-9]/g, ""))
    .filter((alias) => alias.length >= 5);
  if (!aliases.length) return null;

  for (const result of results) {
    const host = toDomain(result.url);
    if (!host || DIRECTORY_HOSTS.some((blocked) => host.endsWith(blocked))) continue;
    const label = host.split(".")[0].replace(/[^a-z0-9]/g, "");
    if (label.length < 4) continue;
    if (aliases.some((alias) => alias === label || alias.startsWith(label) || label.startsWith(alias))) {
      return `https://${host}`;
    }
  }
  return null;
}
