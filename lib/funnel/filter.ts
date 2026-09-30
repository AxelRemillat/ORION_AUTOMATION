import { AT_LEAST_TEN, AT_LEAST_TWENTY, isSmallB2C } from "./eligible";
import { isStaffingNaf } from "@/lib/signals";
import { painForJob } from "./pain-map";
import type { FilterVerdict, HarvestedSignal, Identity } from "./types";

/**
 * ÉTAGE 2 — filtre déterministe. Code pur : ni réseau, ni LLM, ni coût.
 *
 * Chaque rejet porte un motif lisible, stocké avec le signal : c'est ce qui
 * rend l'entonnoir mesurable et explicable. L'ordre des règles est celui du
 * coût d'une erreur : ce qui ne doit JAMAIS être contacté passe en premier.
 */

/** Préfixes NAF préférés par défaut (miroir de funnel_settings). */
export const DEFAULT_PREFERRED_SECTORS = [
  "62", "69", "70", "71", "73", "74", "82", "46", "49", "52", "68",
  "13", "14", "16", "17", "18", "22", "25", "27", "28", "31", "32", "33", "41", "43",
] as const;
/**
 * Secteurs exclus par défaut, QUELLE QUE SOIT la taille (connue ou non).
 *
 * Run du 30/09/2026 (69, 38, 42, 01, 73, 74 · 14 j) : 11 retenus sur 13 étaient
 * des micro-commerces B2C (kebab, restaurant, fleuriste, garderie…). Ils
 * n'ont pas de back-office à automatiser et n'achètent pas d'automatisation.
 *
 *   47   commerce de détail           55, 56  hébergement, restauration
 *   96   services aux particuliers     93      sports et loisirs
 *   88   action sociale (aide à domicile, garde d'enfants…)
 *   862, 869 cabinets médicaux et paramédicaux
 *   812  nettoyage
 *
 * Réglable dans « Signaux » (secteurs exclus). La boulangerie (10.71) est
 * traitée à part : exclue seulement sous 20 salariés CONNUS.
 */
export const DEFAULT_EXCLUDED_SECTORS = ["47", "55", "56", "96", "93", "88", "862", "869", "812"] as const;

/** Défauts du 30/09/2026 (PR #47), pour la migration des réglages enregistrés. */
export const PREVIOUS_EXCLUDED_SECTORS = ["47", "55", "56", "96", "93", "8891", "862", "869", "812"] as const;

/** Anciens défauts, pour la migration des réglages enregistrés. */
export const LEGACY_EXCLUDED_SECTORS = ["4711", "4729", "812", "4742"] as const;

/** Boulangerie-pâtisserie : écartée sous 20 salariés connus (une chaîne de 20+ a un back-office). */
const BAKERY = ["1071"];

/**
 * Micro-structure probable : effectif non déclaré ET société de moins de
 * 24 mois OU sans chiffre d'affaires publié. Les 11 reprises du 30/09 étaient
 * toutes « effectif non déclaré », SIREN créés en 2026, 0 contactable.
 */
export const YOUNG_COMPANY_MONTHS = 24;

/** Reprise de fonds de commerce : seulement par une entreprise établie. */
export const ESTABLISHED_MONTHS = 24;
const FONDS_DE_COMMERCE = /fonds de commerce|reprise d.un fonds|achat d.un fonds|vente d.un fonds|cession d.un fonds/i;

/** Bâtiment : préféré seulement à partir de 20 salariés. */
const BUILDING = ["41", "43"];
/** Tranches INSEE sous 10 salariés : 0, 1-2, 3-5, 6-9. */
const UNDER_TEN = new Set(["00", "01", "02", "03"]);
/** Tranches de 250 salariés et plus : hors cible (PME de 10 à 249 salariés). */
const TWO_HUNDRED_FIFTY_PLUS = new Set(["32", "41", "42", "51", "52", "53"]);
/** Tranches 20 salariés et plus. */
const TWENTY_PLUS = new Set(["12", "21", "22", "31", "32", "41", "42", "51", "52", "53"]);

/** Seuils d'une augmentation de capital qui compte. */
export const CAPITAL_MIN_EUR = 50_000;
export const CAPITAL_MIN_RATIO = 0.05;

/** Jobboards qui republient des offres : l'employeur n'y est pas garanti. */
const AGGREGATORS = /hellowork|trabajo|jobijoba|jooble|optioncarriere|meteojob|jobrapido|neuvoo|talent\.com|indeed|adzuna|careerjet/i;

const COLLECTIVE =
  /tribunal de commerce|redressement judiciaire|liquidation judiciaire|proc[ée]dure de sauvegarde|plan de cession|mandataire judiciaire|administrateur judiciaire/i;
const HALF_CAPITAL = /capitaux propres.{0,40}inf[ée]rieurs? [àa] la moiti[ée] du capital/i;
/** Le signal parle d'un CLIENT de l'entreprise, pas d'elle-même. (`\b` ne voit pas le « é » final : lookahead Unicode.) */
const ABOUT_CLIENT =
  /\b(conseil(le)? (de|du)|a accompagn[ée]|accompagne (le|la|les)|pour le compte de|pour son client|pour ses clients|a conseill[ée]|banque d'affaires de)(?![\p{L}])/iu;
/** Modifications purement juridiques : vraies, datées, sans portée commerciale. */
const LEGAL_ONLY =
  /forme juridique|d[ée]nomination|objet social|nom commercial|modification au registre|transfert.{0,30}holding|apport.{0,30}holding/i;

const prefixMatch = (naf: string | null, prefixes: readonly string[]) => {
  const code = (naf ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return Boolean(code) && prefixes.some((prefix) => code.startsWith(prefix.replace(/[^0-9A-Za-z]/g, "").toUpperCase()));
};

const euros = (value: number) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value)} €`;

/** Motif d'une offre dont l'intitulé ne révèle aucun pain (décidé sans identité). */
export const NO_PAIN_TITLE = "intitulé de poste qui ne révèle aucun pain automatisable";

/** Âge en mois de la société à `now`, ou `null` si la date de création manque. */
export function ageInMonths(createdOn: string | null | undefined, now: Date): number | null {
  if (!createdOn) return null;
  const created = new Date(createdOn);
  if (Number.isNaN(created.getTime())) return null;
  return (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
}

const unknownHeadcount = (code: string | null | undefined) => !code || code === "NN";

/** Une offre d'emploi dont l'intitulé révèle un pain : la preuve qu'ils embauchent. */
const revealingJobOffer = (signal: HarvestedSignal) =>
  signal.source === "france-travail" && Boolean(painForJob(signal.facts.jobTitle ?? signal.text));

export interface FilterOptions {
  preferredSectors?: readonly string[];
  excludedSectors?: readonly string[];
  now?: Date;
}

const reject = (reason: string): FilterVerdict => ({
  status: "rejeté",
  reason,
  weight: 0,
  badges: [],
  legalOnly: false,
});

/**
 * SITES D'AVIS ET FORUMS — jamais un signal.
 *
 * Une note d'employés ou un fil de discussion ne dit rien d'un changement dans
 * l'entreprise : il n'y a ni date d'événement, ni décision, ni sujet. Pire, la
 * page mentionne l'entreprise assez souvent pour passer l'ancrage, et le mail
 * finit par s'ouvrir sur ce que ses salariés pensent d'elle.
 *
 * Cas réel du 28/09/2026 : EFAP RHONE-ALPES SAS (SIREN 509516860) remontait
 * avec, pour seul « signal », sa fiche d'avis gowork.fr.
 */
const REVIEW_SITES = [
  "gowork",
  "glassdoor",
  "indeed.com/cmp",
  "avis-entreprises",
  "avisentreprise",
  "trustpilot",
  "opinion-assurances",
  "custplace",
  "societe-avis",
  "balancetastartup",
  "choosemycompany",
  "reviews.",
  "avis.",
  "forum",
  "reddit",
  "quora",
  "commentcamarche",
  "trustindex",
  "yelp",
  "tripadvisor",
];

export function isReviewSite(url: string | null | undefined): boolean {
  const raw = (url ?? "").toLowerCase();
  if (!raw) return false;
  return REVIEW_SITES.some((needle) => raw.includes(needle));
}

/** Verdict d'un signal, à partir de sa source et de son identité annuaire. */
export function filterSignal(
  signal: HarvestedSignal,
  identity: Identity | null,
  options: FilterOptions = {},
): FilterVerdict {
  if (!identity) return reject("entreprise introuvable à l'annuaire");
  const text = `${signal.facts.label} ${signal.text}`;

  // --- Ne jamais contacter ---------------------------------------------------
  if (identity.adminState === "C") return reject("entreprise cessée");
  if (identity.diffusion && identity.diffusion !== "O") {
    return reject("entreprise non diffusible : opposée à la prospection (statut de diffusion INSEE)");
  }
  if (COLLECTIVE.test(text)) return reject("procédure collective (tribunal de commerce)");
  if (HALF_CAPITAL.test(text)) return reject("capitaux propres inférieurs à la moitié du capital");

  // --- Hors cible ------------------------------------------------------------
  if (isStaffingNaf(identity.naf)) return reject("agence d'emploi : elle recrute pour ses clients");
  const excluded = options.excludedSectors ?? DEFAULT_EXCLUDED_SECTORS;
  if (prefixMatch(identity.naf, excluded)) return reject(`secteur exclu (NAF ${identity.naf})`);
  if (isSmallB2C(identity.naf, identity.effectifCode)) {
    return reject(`commerce de détail ou service aux particuliers de moins de 20 salariés (NAF ${identity.naf})`);
  }
  if (prefixMatch(identity.naf, BAKERY) && identity.effectifCode && !unknownHeadcount(identity.effectifCode) && !AT_LEAST_TWENTY.has(identity.effectifCode)) {
    return reject(`boulangerie de moins de 20 salariés (NAF ${identity.naf})`);
  }
  if (identity.effectifCode && UNDER_TEN.has(identity.effectifCode)) {
    return reject(identity.effectifCode === "00" ? "0 salarié" : "effectif inférieur à 10 salariés");
  }
  if (identity.effectifCode && TWO_HUNDRED_FIFTY_PLUS.has(identity.effectifCode)) {
    return reject("trop grande structure : 250 salariés ou plus (cible 10-249)");
  }

  // Effectif NON DÉCLARÉ : ce n'est pas « on ne sait pas », c'est presque
  // toujours une toute petite structure — sauf si une offre d'emploi prouve
  // qu'elle embauche.
  const now = options.now ?? new Date();
  const months = ageInMonths(identity.createdOn, now);
  if (unknownHeadcount(identity.effectifCode) && !revealingJobOffer(signal)) {
    const young = months !== null && months < YOUNG_COMPANY_MONTHS;
    const noRevenue = identity.revenue == null;
    if (young || noRevenue) {
      return reject(
        `micro-structure probable : effectif non déclaré et ${young ? `société créée il y a ${Math.max(0, months ?? 0)} mois` : "aucun chiffre d'affaires publié"}`,
      );
    }
  }

  // Reprise de fonds de commerce : un signal seulement si le repreneur est une
  // entreprise établie (≥ 10 salariés ET ≥ 2 ans). Sinon, c'est un commerçant
  // qui s'installe, pas un back-office qui grossit.
  if (FONDS_DE_COMMERCE.test(text)) {
    const established =
      AT_LEAST_TEN.has(identity.effectifCode ?? "") && months !== null && months >= ESTABLISHED_MONTHS;
    if (!established) {
      return reject("micro-reprise : repreneur de moins de 10 salariés ou de moins de 2 ans");
    }
  }

  // --- Signal faible ou faux -------------------------------------------------
  if (signal.source === "france-travail" && AGGREGATORS.test(signal.url ?? "") && !identity.employerConfirmed) {
    return reject("offre republiée par un agrégateur, employeur non confirmé");
  }
  if (isReviewSite(signal.url)) return reject("avis/forum : une note de salariés n'est pas un signal d'entreprise");
  if (ABOUT_CLIENT.test(text)) return reject("le signal parle d'un client de l'entreprise, pas d'elle");
  if (signal.source === "france-travail" && !painForJob(signal.facts.jobTitle ?? signal.text)) {
    return reject(NO_PAIN_TITLE);
  }

  let weight = signal.facts.strength === "fort" ? 0.7 : signal.facts.strength === "moyen" ? 0.5 : 0.25;
  const badges: string[] = [];

  const { capitalAfter, capitalBefore } = signal.facts;
  const capitalMove = /capital/i.test(signal.facts.label);
  if (capitalMove && capitalAfter != null && capitalBefore != null && capitalBefore > 0) {
    const delta = capitalAfter - capitalBefore;
    if (delta <= 0) return reject(`réduction de capital (${euros(delta)})`);
    if (delta < CAPITAL_MIN_EUR || delta / capitalBefore < CAPITAL_MIN_RATIO) {
      return reject(`augmentation de capital marginale (+${euros(delta)}) : bruit, pas une croissance`);
    }
  } else if (capitalMove) {
    // Sens et montant inconnus : un fait, pas une croissance.
    weight = Math.min(weight, 0.35);
    badges.push("montant de capital inconnu");
  }

  const legalOnly = LEGAL_ONLY.test(text) && !(signal.facts.newLeaders?.length ?? 0);
  if (legalOnly) weight = Math.min(weight, 0.2);

  // --- Bonus -----------------------------------------------------------------
  const building = prefixMatch(identity.naf, BUILDING);
  const preferred = prefixMatch(identity.naf, options.preferredSectors ?? DEFAULT_PREFERRED_SECTORS);
  if (preferred && (!building || TWENTY_PLUS.has(identity.effectifCode ?? ""))) weight += 0.15;
  if (!identity.effectifCode || identity.effectifCode === "NN") {
    weight -= 0.05;
    badges.push("effectif non déclaré");
  }
  if (identity.isBranch) badges.push(`décision au siège${identity.headOfficeCity ? ` (${identity.headOfficeCity})` : ""}`);

  const age = (now.getTime() - new Date(signal.date).getTime()) / 86_400_000;
  if (age <= 7) weight += 0.05;

  return {
    status: "filtré",
    reason: null,
    weight: Math.max(0, Math.min(1, Number(weight.toFixed(3)))),
    badges,
    legalOnly,
  };
}
