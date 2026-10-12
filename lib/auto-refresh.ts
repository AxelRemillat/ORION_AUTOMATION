/**
 * RAFRAÎCHISSEMENT AUTOMATIQUE (Cowork #23) — règles pures, testables sans navigateur.
 *
 * Toutes les 60 s, les données de la page sont relues (router.refresh : l'état de
 * l'écran — sélection, défilement, brouillons — est gardé). Jamais quand l'onglet
 * est caché, ni pendant qu'Axel saisit quelque chose : un champ, une zone de texte,
 * une liste déroulante ou un élément éditable a le focus, ou une zone marquée
 * `data-editing` (éditeur ouvert) est présente.
 */
export const AUTO_REFRESH_MS = 60_000;

export interface RefreshContext {
  visible: boolean;
  /** Balise de l'élément actif (« INPUT », « TEXTAREA »…), en majuscules. */
  activeTag: string | null;
  activeEditable: boolean;
  /** Type d'un <input> actif : un bouton ou une case n'est pas une saisie. */
  activeType?: string | null;
  /** Un éditeur ouvert le signale (`data-editing`). */
  editing: boolean;
}

const NOT_TYPING = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"]);

/** Une saisie est-elle en cours ? */
export function isTyping(context: Pick<RefreshContext, "activeTag" | "activeEditable" | "activeType" | "editing">): boolean {
  if (context.editing || context.activeEditable) return true;
  if (context.activeTag === "TEXTAREA" || context.activeTag === "SELECT") return true;
  return context.activeTag === "INPUT" && !NOT_TYPING.has((context.activeType ?? "text").toLowerCase());
}

export const shouldRefresh = (context: RefreshContext): boolean => context.visible && !isTyping(context);

/** « à jour à l'instant », « à jour il y a 45 s », « à jour il y a 3 min ». */
export function freshnessLabel(lastRefresh: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - lastRefresh) / 1000));
  if (seconds < 5) return "à jour à l'instant";
  if (seconds < 60) return `à jour il y a ${seconds} s`;
  return `à jour il y a ${Math.floor(seconds / 60)} min`;
}
