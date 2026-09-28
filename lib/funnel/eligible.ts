/**
 * Ce qui disqualifie une entreprise APRÈS le creusage payant.
 *
 * L'étage 4 ouvre la fiche chez Pappers : c'est le premier moment où l'on
 * connaît son opposition à la prospection et ses capitaux propres. Deux motifs
 * de renoncement, à vérifier AVANT de publier la fiche.
 */

export interface DigFacts {
  /** `opposition_utilisation_commerciale` du registre Sirene, via Pappers. */
  refusesProspecting: boolean;
  /** Aucun salarié, DÉCLARÉ (et non « effectif inconnu »). */
  noStaff: boolean;
  capitalEur: number | null;
  /** Capitaux propres du dernier exercice publié. `null` = comptes confidentiels. */
  equityEur: number | null;
}

export type Disqualification = { reason: string } | null;

/**
 * OPPOSITION À LA PROSPECTION — la seule source qui la porte est Pappers.
 *
 * Vérifié sur DBP MEDICAL (SIREN 844687566) le 28/09/2026 : l'API Recherche
 * d'entreprises rend `statut_diffusion: "O"` et
 * `statut_diffusion_etablissement: "O"`. Ce champ dit si la fiche est
 * DIFFUSIBLE — il ne dit rien de la prospection, et il vaut « O » pour cette
 * société. Pappers, lui, rend `opposition_utilisation_commerciale: true`.
 *
 * C'est donc sur ce champ que l'exclusion est branchée. Écrire à une entreprise
 * qui s'y est opposée n'est pas une question de rendement.
 */
export function opposesProspecting(facts: DigFacts): Disqualification {
  return facts.refusesProspecting
    ? { reason: "opposition à la prospection commerciale déclarée au registre" }
    : null;
}

/**
 * CAPITAUX PROPRES INFÉRIEURS À LA MOITIÉ DU CAPITAL.
 *
 * C'est le seuil d'alerte du code de commerce (art. L. 223-42 pour les SARL,
 * L. 225-248 pour les SA) : les associés doivent se prononcer sur la poursuite
 * de l'activité. Une entreprise dans cet état ne lance pas un chantier
 * d'automatisation — et lui écrire comme si de rien n'était se voit.
 *
 * Sans comptes publiés, la règle ne s'applique pas : une petite société peut
 * déposer ses comptes en confidentialité, et l'absence de chiffre n'est pas un
 * mauvais chiffre. Constaté sur GLOBAL 2F (SIREN 833040736), qui n'a AUCUNE
 * donnée de comptes chez Pappers ni à l'annuaire — cette fiche est écartée plus
 * tôt, à l'étage 2, parce qu'elle déclare zéro salarié.
 */
export function equityTooLow(facts: DigFacts): Disqualification {
  const { capitalEur, equityEur } = facts;
  if (capitalEur === null || equityEur === null || capitalEur <= 0) return null;
  if (equityEur >= capitalEur / 2) return null;
  return {
    reason: `capitaux propres (${Math.round(equityEur)} €) sous la moitié du capital (${Math.round(capitalEur)} €)`,
  };
}

/**
 * AUCUN SALARIÉ, déclaré au registre.
 *
 * Une société sans employé n'a pas de back-office qui déborde : il n'y a rien à
 * automatiser, et le mail tombe à plat. Le filtre de l'étage 2 ne peut pas
 * l'écarter — l'annuaire public rend la tranche « NN » (non renseigné) pour
 * GLOBAL 2F (833040736) alors que Pappers rend « 0 salarié », `effectif_max: 0`
 * et `entreprise_employeuse: false`. Vérifié le 28/09/2026.
 */
export function noStaff(facts: DigFacts): Disqualification {
  return facts.noStaff ? { reason: "aucun salarié déclaré au registre" } : null;
}

/** Premier motif de renoncement, ou `null` si la fiche peut être publiée. */
export function disqualify(facts: DigFacts): Disqualification {
  return opposesProspecting(facts) ?? noStaff(facts) ?? equityTooLow(facts);
}

/** `prefixMatch` local : le module doit rester SANS dépendance (client compris). */
const prefixMatch = (naf: string | null | undefined, prefixes: readonly string[]): boolean => {
  const code = (naf ?? "").replace(/\D/g, "");
  return Boolean(code) && prefixes.some((prefix) => code.startsWith(prefix.replace(/\D/g, "")));
};

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
