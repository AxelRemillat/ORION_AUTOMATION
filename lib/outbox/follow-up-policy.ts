/**
 * RELANCE PERMISE ? — une seule règle, partout : Cockpit, « Aujourd'hui »,
 * Pipeline, préparation quotidienne, programmation et envoi (tick n8n compris,
 * via lib/outbox/send.ts).
 *
 * 03/10/2026 : le Cockpit proposait « Relancer HUMAN SIGHT / SELECTION HABITAT
 * / BRIOL DIFFUSION », trois entreprises (avec SARL BONNIN FRERES) opposées à
 * la prospection. Une relance n'est JAMAIS proposée ni programmée pour un
 * prospect :
 *   - opposé à la prospection (registre) ;
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
  return null;
}

export const followUpRefusal = (reason: string) => `Relance refusée : ${reason}.`;
