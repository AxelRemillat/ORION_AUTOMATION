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
import { mentionsExactDenomination } from "./entity-match";
import { classifyJobSource, jobTitleIn, listsOffersWithoutTitle, JOB_SOURCE_WEIGHT } from "./job-source";

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

/**
 * Registres et agregateurs : ils REPRODUISENT la fiche legale, ils n'attestent
 * aucun evenement. Un mot-cle qui y apparait vient de la raison sociale ou du
 * libelle NAF, jamais d'une actualite.
 *
 * A ne pas confondre avec DIRECTORY_HOSTS plus bas : les sites d'emploi
 * (Indeed, Welcome to the Jungle, LinkedIn) n'y figurent PAS — une offre
 * publiee chez eux est au contraire une preuve valable de recrutement.
 */
const REGISTRY_HOSTS = [
  // Fiches d'entreprise : elles existent pour toute societe immatriculee et
  // ne disent rien de son actualite. Une offre LinkedIn (/jobs/view/) reste
  // valable — elle est traitee a part par `classifyJobSource`.
  "linkedin.com",
  "fr.linkedin.com",
  "annuaire-entreprises.data.gouv.fr",
  "entreprise.data.gouv.fr",
  "data.gouv.fr",
  "pappers.fr",
  "societe.com",
  "societe.ninja",
  "infogreffe.fr",
  "bodacc.fr",
  "verif.com",
  "manageo.fr",
  "kompass.com",
  "infonet.fr",
  "score3.fr",
  "b-reputation.com",
  "dirigeant.com",
  "entreprises.lefigaro.fr",
  "usinenouvelle.com/annuaire",
];

/** Vrai si l'hote se contente de republier des donnees d'immatriculation. */
export function isRegistryHost(host: string): boolean {
  const clean = host.toLowerCase().replace(/^www\./, "");
  return REGISTRY_HOSTS.some((blocked) => clean === blocked || clean.endsWith(`.${blocked}`));
}

/**
 * Retire d'un texte toute occurrence de la raison sociale.
 *
 * Sans cela, « RAS INTERIM JERECRUTE » declenchait un signal Recrutement : le
 * mot-cle « recrute » etait dans son propre NOM. On masque donc les alias
 * complets ET chaque mot significatif du nom avant de tester les regles. Une
 * entreprise qui s'appelle « Recrutement Plus » ne peut plus emettre de signal
 * de recrutement sur son seul nom — c'est voulu : ce n'est pas une actualite.
 */
export function maskCompanyName(text: string, aliases: string[]): string {
  let masked = normalize(text);
  const tokens = new Set<string>();
  for (const alias of aliases) {
    if (alias.length >= 4) tokens.add(alias);
    for (const word of alias.split(/[^a-z0-9]+/)) {
      if (word.length >= 5) tokens.add(word);
    }
  }
  // Du plus long au plus court : masquer l'alias entier avant ses morceaux.
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    masked = masked.split(token).join(" ");
  }
  return masked.replace(/\s+/g, " ").trim();
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
/**
 * Un signal faible franchit un seuil abaisse de 30 %.
 *
 * L'ancrage sur l'entreprise, lui, reste obligatoire : on assouplit la
 * CONFIANCE dans la source, jamais la preuve que l'evenement la concerne.
 */
const WEAK_THRESHOLD_RATIO = 0.7;

/**
 * Plancher d'un signal faible : la valeur de l'ancrage seul.
 *
 * Le profil dominant d'un signal faible — la preuve nomme l'entreprise, mais
 * elle n'est ni datee ni sur une source de premiere main — vaut exactement
 * 0,5. Sans ce plancher, les regles les plus exigeantes (levee a 0,8, donc
 * 0,56 en faible) le rejetaient d'un cheveu, et la souplesse ne servait a
 * rien la ou elle est justement utile.
 *
 * Ce qui reste ecarte : le bruit (aucune regle) et les homonymes (preuve non
 * ancree). L'ancrage n'est JAMAIS assoupli.
 */
const WEAK_FLOOR = 0.5;

/** Pourquoi un resultat n'a pas produit de signal. */
export type RejectReason =
  | "registre"
  | "aucune-regle"
  | "non-ancre"
  | "source-emploi-absente"
  | "intitule-manquant"
  | "sous-le-seuil"
  | "quota-par-type"
  | "plafond-signaux";

/** Entonnoir d'un scan, renseigne a la demande. Aucun cout quand absent. */
export interface QualifyTrace {
  raw: number;
  emitted: number;
  rejected: { reason: RejectReason; host: string; type?: string; confidence?: number }[];
}

export function qualifyWebResults(
  results: WebResult[],
  target: QualifyTarget,
  trace?: QualifyTrace,
): ProspectSignal[] {
  const aliases = companyAliases(target.name);
  const ownDomain = toDomain(target.website ?? null);
  const counts = new Map<string, number>();
  const signals: ProspectSignal[] = [];

  if (trace) trace.raw += results.length;

  for (const result of results) {
    const host = hostOf(result.url);
    const drop = (reason: RejectReason, extra?: { type?: string; confidence?: number }) => {
      trace?.rejected.push({ reason, host, ...extra });
    };

    if (signals.length >= MAX_SIGNALS) {
      drop("plafond-signaux");
      continue;
    }

    // Un registre republie la fiche d'immatriculation : il ne prouve pas un
    // evenement, mais il n'est pas du bruit pour autant. On ne le jette plus
    // ici — la decision est prise APRES l'ancrage, et il ressort en signal
    // faible plutot que de disparaitre (45 % des resultats finissaient la).
    const fromRegistry = isRegistryHost(host);
    const onOwnSite = Boolean(ownDomain && host.endsWith(ownDomain));
    // Denomination EXACTE : « Jacquet Metal Service » ne nomme pas JACQUET PARIS.
    const namedInTitle = mentionsExactDenomination(result.title, target.name);

    // On cherche LA phrase qui prouve, dans le contenu reel de la source.
    const candidates = [...sentences(result.snippet), result.title].filter(Boolean);

    let matched: { rule: Rule; sentence: string; named: boolean } | null = null;
    for (const rule of RULES) {
      // La regle doit matcher HORS raison sociale : le nom de l'entreprise
      // n'est pas une preuve de ce qu'elle fait.
      const sentence = candidates.find(
        (candidate) =>
          rule.pattern.test(candidate) && rule.pattern.test(maskCompanyName(candidate, aliases)),
      );
      if (!sentence) continue;
      const named = mentionsExactDenomination(sentence, target.name);
      // Ancrage obligatoire : la preuve doit concerner CETTE entreprise.
      if (!named && !onOwnSite) continue;
      matched = { rule, sentence, named };
      break;
    }
    if (!matched) {
      // Distinguer les deux echecs : aucune regle ne matche, ou une regle
      // matche mais la preuve ne nomme pas l'entreprise.
      const anyRule = RULES.some((rule) =>
        candidates.some(
          (candidate) =>
            rule.pattern.test(candidate) && rule.pattern.test(maskCompanyName(candidate, aliases)),
        ),
      );
      drop(anyRule ? "non-ancre" : "aucune-regle");
      continue;
    }

    const { rule, sentence, named } = matched;
    const date = result.date ? extractDate(result.date) : null;
    const foundDate = date ?? extractDate(`${result.title} ${result.snippet}`);

    // --- Recrutement : une offre, pas une page qui en liste ---------------
    //
    // Sans ce filtre, « 12 offres d'emploi chez X » sur un agregateur valait
    // autant qu'une annonce d'automaticien sur le site de l'entreprise.
    let sourceWeight = 1;
    let jobTitle: string | null = null;
    if (rule.type === "recrutement") {
      const kind = classifyJobSource(result.url, ownDomain);
      if (kind === "aucune") {
        drop("source-emploi-absente", { type: rule.type });
        continue;
      }
      jobTitle = jobTitleIn(`${result.title} ${result.snippet}`);
      // Un agregateur ne prouve qu'une chose : l'entreprise existe. On le
      // garde comme signal faible, jamais comme accroche — et on oublie
      // l'intitule qu'il aurait devine, il n'est pas fiable.
      if (kind === "agregateur") {
        sourceWeight = JOB_SOURCE_WEIGHT.agregateur;
        if (listsOffersWithoutTitle(result.title)) jobTitle = null;
      }
      // Sur une source officielle, l'intitule reste exige : « nous recrutons »
      // sans metier ne permet ni d'ecrire, ni de juger l'automatisabilite.
      if (kind === "officielle" && !jobTitle && !onOwnSite) {
        drop("intitule-manquant", { type: rule.type });
        continue;
      }
    }

    let confidence = 0;
    if (named) confidence += 0.5;
    // Etre sur le domaine de l'entreprise vaut identification : c'est sa page.
    if (onOwnSite) confidence += 0.5;
    if (namedInTitle) confidence += 0.15;
    if (foundDate) confidence += 0.2;
    if (rule.pattern.test(maskCompanyName(result.title, aliases))) confidence += 0.1;
    confidence = Math.min(1, Number(confidence.toFixed(2)));

    // Faible = la preuve tient, mais sa source ou sa datation laissent un
    // doute. Elle reste visible, classee plus bas, jamais presentee comme une
    // actualite datee.
    const weak = fromRegistry || !foundDate;
    const bar = weak
      ? Math.min(rule.minConfidence * WEAK_THRESHOLD_RATIO, WEAK_FLOOR)
      : rule.minConfidence;
    if (confidence < bar) {
      drop("sous-le-seuil", { type: rule.type, confidence });
      continue;
    }

    const count = counts.get(rule.type) ?? 0;
    if (count >= MAX_PER_TYPE) {
      drop("quota-par-type", { type: rule.type });
      continue;
    }
    counts.set(rule.type, count + 1);

    signals.push({
      type: rule.type,
      // Le libelle decrit la PREUVE, jamais une promesse commerciale.
      label: jobTitle
        ? `Poste ouvert : ${jobTitle} — ${host}${foundDate ? `, ${frenchDate(foundDate)}` : ""}`
        : `${rule.claim} — ${host}${foundDate ? `, ${frenchDate(foundDate)}` : ""}`,
      url: result.url,
      source: host,
      ...(foundDate ? { date: foundDate } : {}),
      ...(jobTitle ? { jobTitle } : {}),
      // Part des points selon la qualite de la source : un agregateur
      // generique ne pese qu'un quart, et ne peut pas porter l'accroche.
      ...(sourceWeight < 1 ? { sourceWeight, weakSource: true } : {}),
      quote: sentence.slice(0, 260),
      confidence,
      ...(weak ? { strength: "faible" as const } : {}),
    });
  }

  if (trace) trace.emitted += signals.length;
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
    // La confiance croit avec la taille : a 20 personnes le back-office peut
    // tenir dans un tableur, a 200 il ne tient plus. Sans cette variation,
    // toutes les entreprises sans actualite recevaient le meme score.
    const confidence = Math.min(0.7, 0.35 + Math.log10(size / 10) * 0.25);
    signals.push({
      type: "structure",
      label: `Effectif d'au moins ${size} personnes — back-office et reporting à fort volume`,
      source: "Données INSEE",
      confidence: Number(confidence.toFixed(2)),
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
