/**
 * RELANCE PERMISE ? — une seule règle, partout : Cockpit, « Aujourd'hui »,
 * Pipeline, préparation quotidienne, programmation et envoi (tick n8n compris,
 * via lib/outbox/send.ts).
 *
 * 03/10/2026 : le Cockpit proposait « Relancer HUMAN SIGHT / SELECTION HABITAT
 * / BRIOL DIFFUSION », trois entreprises (avec SARL BONNIN FRERES) opposées à
 * la prospection. Une relance n'est JAMAIS proposée ni programmée pour un
 * prospect :
 *   - opposé à la prospection (registre), ou dont l'opposition n'est pas vérifiée ;
 *   - marqué « ne plus contacter » ;
 *   - perdu ;
 *   - qui a répondu (statut, ou réponse reçue depuis le dernier envoi).
 *
 * Code pur : le motif, ou `null` si la relance est permise.
 */

/** Statuts où la relance n'a plus lieu d'être : la conversation existe, ou l'affaire est close. */
const NO_FOLLOW_UP_STATUS: Record<string, string> = {
  repondu: "a répondu",
  en_discussion: "a répondu",
  gagne: "affaire gagnée",
  perdu: "perdu",
};

/**
 * L'opposition à la prospection est-elle VÉRIFIÉE ? Lue au registre (Pappers),
 * vérifiée (INPI, Pappers, à la main), ou déjà connue comme opposée. Une fiche
 * sans aucune de ces marques n'est PAS sûre (04/10/2026 : ARTFLEX et BOUVET
 * CARTIER avaient une relance prévue sans vérification — BOUVET était opposée).
 */
export function oppositionVerified(figures: Record<string, unknown> | null | undefined): boolean {
  const facts = figures ?? {};
  return facts.pappers_read === true || facts.opposition_checked === true || facts.refuses_prospecting === true;
}

export const UNVERIFIED_OPPOSITION = "opposition non vérifiée";

export function followUpBlock(
  prospect: { status?: string | null; do_not_contact?: boolean | null; key_figures?: Record<string, unknown> | null } | null,
  options: { replied?: boolean } = {},
): string | null {
  if (!prospect) return "prospect introuvable";
  if (prospect.key_figures?.refuses_prospecting === true) return "opposé à la prospection";
  if (prospect.do_not_contact) return "ne plus contacter";
  const byStatus = prospect.status ? NO_FOLLOW_UP_STATUS[prospect.status] : undefined;
  if (byStatus) return byStatus;
  if (options.replied) return "a répondu";
  // Non vérifiée = bloquant, au même titre qu'opposé : la préparation la vérifie (INPI d'abord).
  if (!oppositionVerified(prospect.key_figures)) return UNVERIFIED_OPPOSITION;
  return null;
}

export const followUpRefusal = (reason: string) => `Relance refusée : ${reason}.`;
