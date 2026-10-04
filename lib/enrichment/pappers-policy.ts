import type { CompanyBase } from "./types";

/**
 * SOBRIÉTÉ PAPPERS (05/10/2026) — forfait ~500 crédits par mois, soit ~24 par
 * jour ouvré. Pappers n'est appelé que pour ce qui n'existe NULLE PART ailleurs :
 *
 *   - identité, NAF, tranche d'effectif, dirigeants, CA et résultat → API
 *     Recherche d'entreprises (gratuite, déjà lue à l'identification) ;
 *   - opposition à la prospection → API RNE de l'INPI (gratuite) ;
 *   - Pappers SEULEMENT si l'annuaire ne publie aucun chiffre financier, ou si
 *     l'entreprise est dirigée par une SOCIÉTÉ (holding à résoudre : dirigeant
 *     réel, taille du groupe — Pappers seul les donne).
 *
 * Ce qu'on perd sans Pappers, assumé : capitaux propres (alerte « capitaux
 * propres sous la moitié du capital »), effectif exact, dates d'ouverture
 * d'établissements (accroche « vous avez ouvert à … »).
 */
export type PappersNeed = { needed: true; reason: string } | { needed: false; reason: string };

export function pappersNeed(base: Pick<CompanyBase, "siren" | "parent_company" | "figures">): PappersNeed {
  if (!base.siren) return { needed: false, reason: "pas de SIREN" };
  if (base.parent_company) return { needed: true, reason: `dirigée par une société (${base.parent_company}) : holding à résoudre` };
  const revenue = base.figures?.revenue_eur;
  if (revenue == null || revenue <= 0) return { needed: true, reason: "aucun chiffre financier publié dans l'annuaire" };
  return { needed: false, reason: "annuaire suffisant (identité, effectif, dirigeants, CA) ; opposition à l'INPI" };
}
