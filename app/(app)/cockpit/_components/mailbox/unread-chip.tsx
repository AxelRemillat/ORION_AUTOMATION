"use client";

import { useInboxRead } from "./read-state";

/**
 * « N non lu(s) » de l'onglet « Reçus ». Suit les clics à l'instant où ils ont
 * lieu (compteur optimiste) et retombe sur la valeur du serveur hors contexte.
 */
export function UnreadChip({ fallback }: { fallback: number }) {
  const state = useInboxRead();
  const count = state?.unreadCount ?? fallback;
  if (count <= 0) return null;

  return (
    <span className="font-data rounded-full border border-warn/30 bg-warn/15 px-1.5 text-[11px] font-semibold text-warn-ink">
      {count} non lu{count > 1 ? "s" : ""}
    </span>
  );
}
