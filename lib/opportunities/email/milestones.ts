import type { OpportunityStatus } from "../types";
import type { EmailKind } from "./parse";

/**
 * Avancement du statut d'une fiche par les e-mails de suivi, et jalons datés.
 * Code pur (partagé par l'ingestion, le tri à la main et la page).
 */

/** Rang d'avancement : un statut n'avance que vers la droite (« Perdue » à part). */
const RANK: Record<OpportunityStatus, number> = { a_repondre: 0, ignoree: 0, envoyee: 1, reponse: 2, entretien: 3, gagnee: 4, perdue: -1 };

/**
 * Statut après un événement, ou `null` s'il ne bouge pas :
 *   message → « Réponse » (le client a répondu), puis « Conversation » au suivant ;
 *   offre → « Conversation » au moins ; mission confirmée → « Gagnée » ;
 *   clôture → « Perdue », sauf une mission déjà gagnée.
 */
export function statusAfterEvent(current: OpportunityStatus, kind: EmailKind): OpportunityStatus | null {
  const target: OpportunityStatus | null =
    kind === "message" ? (RANK[current] >= RANK.reponse ? "entretien" : "reponse")
    : kind === "offre" ? "entretien"
    : kind === "gagnee" ? "gagnee"
    : kind === "perdue" ? "perdue"
    : null;
  if (!target || target === current) return null;
  if (target === "perdue") return current === "gagnee" || current === "perdue" ? null : "perdue";
  // Une affaire perdue qui reprend (nouveau message, offre) revient dans le suivi.
  if (current === "perdue") return target;
  return RANK[target] > RANK[current] ? target : null;
}

/** Champs datés posés avec un statut (jamais effacés). */
export function milestones(status: OpportunityStatus, current: { sent_at?: string | null; replied_at?: string | null; conversation_at?: string | null; won_at?: string | null }, now: string): Record<string, string> {
  const patch: Record<string, string> = {};
  if (RANK[status] >= RANK.envoyee && !current.sent_at) patch.sent_at = now;
  if (RANK[status] >= RANK.reponse && !current.replied_at) patch.replied_at = now;
  if (RANK[status] >= RANK.entretien && !current.conversation_at) patch.conversation_at = now;
  if (status === "gagnee" && !current.won_at) patch.won_at = now;
  return patch;
}
