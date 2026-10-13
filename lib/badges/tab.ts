import type { BadgeCounts } from "./counts";

/**
 * COMPTEUR DE L'ONGLET (Cowork #28) — règles pures, testables sans navigateur.
 *
 * N = mails reçus non lus qui demandent une action + alertes Opportunités non
 * vues. Aucune règle de comptage ici : les deux nombres viennent tels quels des
 * badges de la barre (`badgeCounts`, lib/badges/counts.ts). Exemple d'Axel :
 * 2 réponses + 3 offres Codeur → « (5) ».
 */
export function tabCount(badges: Pick<BadgeCounts, "alerts" | "unread">): number {
  return Math.max(0, badges.alerts) + Math.max(0, badges.unread);
}

const PREFIX = /^\(\d+\+?\)\s+/;

/** « (5) Paramètres · ORION » ; N = 0 → le titre d'origine, sans préfixe. */
export function tabTitle(title: string, count: number): string {
  const base = title.replace(PREFIX, "");
  return count > 0 ? `(${count > 99 ? "99+" : count}) ${base}` : base;
}

/** Texte de la pastille du favicon : la place manque au-delà de deux chiffres. */
export const faviconLabel = (count: number): string => (count > 99 ? "99+" : String(count));
