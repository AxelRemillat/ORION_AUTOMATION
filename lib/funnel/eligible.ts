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
