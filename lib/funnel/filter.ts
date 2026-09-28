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
/** Épicerie, nettoyage, commerce de détail télécom. */
export const DEFAULT_EXCLUDED_SECTORS = ["4711", "4729", "812", "4742"] as const;

/**
 * COMMERCE DE DÉTAIL ET SERVICES AUX PARTICULIERS — écartés sous 20 salariés.
 *
 * Mesuré sur le run 69+31 du 28/09/2026 : les DIX fiches retenues étaient des
 * reprises de fonds de commerce B2C — une boulangerie, deux opticiens, un
 * institut de beauté, une salle de sport, un paysagiste. Ces commerces n'ont pas
 * de back-office qui déborde : le gérant fait tout, et il n'achète pas
 * d'automatisation.
 *
 * Au-delà de 20 salariés, c'est une autre entreprise : une chaîne d'optique à
 * trente personnes a bien un service ADV. Le seuil garde donc la porte ouverte.
 *
 *   47.xx  commerce de détail
 *   96.xx  autres services personnels (coiffure, beauté, pressing…)
 *   93.13Z salles de sport
 *   56.1   restaurants — hors traiteur B2B (56.21Z), qui livre des entreprises
 *   96.03Z pompes funèbres, 95.xx réparation d'articles domestiques
 */
export const B2C_NAF_PREFIXES = ["47", "96", "9313", "561", "9521", "9522", "9523", "9524", "9525", "9529"] as const;

/** Traiteur : le seul 56 qui vend à des entreprises. */
const B2B_CATERING = ["5621"] as const;

/** Au-dessus de ce seuil, un commerce a un back-office et des salariés à soulager. */
export const B2C_MIN_HEADCOUNT_CODE = "21";

/**
 * Codes de tranche INSEE représentant au moins 20 salariés.
 * 21 = 20-49, 22 = 50-99, 31 = 100-199, 32 = 200-249, 41, 42, 51, 52, 53.
 */
const AT_LEAST_TWENTY = new Set(["21", "22", "31", "32", "41", "42", "51", "52", "53"]);

export function isSmallB2C(naf: string | null | undefined, effectifCode: string | null | undefined): boolean {
  if (!naf) return false;
  if (prefixMatch(naf, B2B_CATERING)) return false;
  if (!prefixMatch(naf, B2C_NAF_PREFIXES)) return false;
  return !(effectifCode && AT_LEAST_TWENTY.has(effectifCode));
}

/** Bâtiment : préféré seulement à partir de 20 salariés. */
const BUILDING = ["41", "43"];
/** Tranches INSEE sous 10 salariés : 0, 1-2, 3-5, 6-9. */
const UNDER_TEN = new Set(["00", "01", "02", "03"]);
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
  if (identity.effectifCode && UNDER_TEN.has(identity.effectifCode)) {
    return reject(identity.effectifCode === "00" ? "0 salarié" : "effectif inférieur à 10 salariés");
  }

  // --- Signal faible ou faux -------------------------------------------------
  if (signal.source === "france-travail" && AGGREGATORS.test(signal.url ?? "") && !identity.employerConfirmed) {
    return reject("offre republiée par un agrégateur, employeur non confirmé");
  }
  if (ABOUT_CLIENT.test(text)) return reject("le signal parle d'un client de l'entreprise, pas d'elle");
  if (signal.source === "france-travail" && !painForJob(signal.facts.jobTitle ?? signal.text)) {
    return reject("intitulé de poste qui ne révèle aucun pain automatisable");
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

  const age = ((options.now ?? new Date()).getTime() - new Date(signal.date).getTime()) / 86_400_000;
  if (age <= 7) weight += 0.05;

  return {
    status: "filtré",
    reason: null,
    weight: Math.max(0, Math.min(1, Number(weight.toFixed(3)))),
    badges,
    legalOnly,
  };
}
