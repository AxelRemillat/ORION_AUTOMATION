import type { CompanyBase } from "./types";

/**
 * SOBRIÉTÉ PAPPERS (05/10/2026) — forfait ~500 crédits par mois, soit ~24 par
 * jour ouvré. Pappers n'est appelé que pour ce qui n'existe NULLE PART ailleurs :
 *
 *   - identité, NAF, tranche d'effectif, dirigeants, CA et résultat → API
 *     Recherche d'entreprises (gratuite, déjà lue à l'identification) ;
 *   - opposition à la prospection → API RNE de l'INPI (gratuite) ;
 *   - holding (société dirigeante) → résolue dans l'annuaire : dirigeant
 *     personne physique, tranche d'effectif, CA (lib/enrichment/holding-free.ts) ;
 *   - Pappers SEULEMENT si l'annuaire ne publie aucun chiffre financier.
 *
 * Ce qu'on perd sans Pappers, assumé : capitaux propres (alerte « capitaux
 * propres sous la moitié du capital »), effectif exact, dates d'ouverture
 * d'établissements (accroche « vous avez ouvert à … »).
 */
export type PappersNeed = { needed: true; reason: string } | { needed: false; reason: string };

export function pappersNeed(base: Pick<CompanyBase, "siren" | "parent_company" | "figures">): PappersNeed {
  if (!base.siren) return { needed: false, reason: "pas de SIREN" };
  // Holdings résolues dans l'annuaire gratuit depuis le 05/10/2026 (holding-free.ts) :
  // une société dirigeante ne justifie plus, à elle seule, un crédit Pappers.
  const revenue = base.figures?.revenue_eur;
  if (revenue == null || revenue <= 0) return { needed: true, reason: "aucun chiffre financier publié dans l'annuaire" };
  return { needed: false, reason: "annuaire suffisant (identité, effectif, dirigeants, CA) ; opposition à l'INPI" };
}
