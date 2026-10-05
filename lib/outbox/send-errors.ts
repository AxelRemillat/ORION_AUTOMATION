/**
 * Erreurs d'envoi LISIBLES. Le message brut (réponse n8n) reste stocké tel quel
 * dans `send_error` ; l'écran affiche sa traduction.
 *
 * 05/10/2026 : 4 intros en « Échec » — credential Gmail expiré côté n8n, qui
 * répondait 500 (« Error in workflow »). Le webhook d'envoi n'appelle QUE le
 * nœud Gmail : un 5xx de n8n, ou un message qui parle de credential / reconnect
 * / OAuth, signe une connexion Gmail à refaire dans n8n.
 */

export const GMAIL_AUTH_MESSAGE = "Connexion Gmail expirée dans n8n — reconnecte le credential puis clique Renvoyer";

const AUTH_HINT = /credential|reconnect|re-?authori[sz]e|oauth|invalid_grant|token (has been )?expired|unauthori[sz]ed|\b401\b/i;
const N8N_SERVER_ERROR = /n8n a répondu 5\d\d/i;

export function isGmailAuthError(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return raw.includes(GMAIL_AUTH_MESSAGE) || AUTH_HINT.test(raw) || N8N_SERVER_ERROR.test(raw);
}

/** Ce que l'écran affiche à la place du JSON brut. */
export function readableSendError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (isGmailAuthError(raw)) return GMAIL_AUTH_MESSAGE;
  // Autres erreurs : on retire l'enveloppe JSON ({"message":"…"}) quand il y en a une.
  const json = /\{"message":"([^"]+)"\}/.exec(raw);
  return json ? raw.replace(json[0], json[1]).trim() : raw.trim();
}
