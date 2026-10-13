"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { tabTitle } from "@/lib/badges/tab";
import { paintFaviconBadge } from "./favicon-badge";

/**
 * Compteur dans l'onglet du navigateur (Cowork #28) : « (N) » devant le titre
 * et pastille sur le favicon, sur toutes les pages. N = 0 → titre et favicon
 * normaux. Rien n'est affiché dans la page elle-même.
 */
export function TabBadge({ count }: { count: number }) {
  const pathname = usePathname();

  // Next réécrit le titre à chaque navigation : on réapplique le préfixe dès qu'il change.
  useEffect(() => {
    const apply = () => {
      const next = tabTitle(document.title, count);
      if (next !== document.title) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [count, pathname]);

  useEffect(() => {
    void paintFaviconBadge(count).catch(() => undefined);
  }, [count]);

  return null;
}
