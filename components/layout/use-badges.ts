"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { BadgeCounts } from "@/lib/badges/counts";

/**
 * Badges de la barre, JAMAIS figés.
 *
 * La barre est rendue par le layout : Next ne le rejoue pas lors d'une
 * navigation côté client, et les compteurs restaient donc ceux du premier
 * chargement — Axel voyait « Opportunités 2 » longtemps après avoir tout
 * traité. On repart de la valeur rendue par le serveur (pas de clignotement),
 * puis on la recalcule à chaque changement de page et au retour sur l'onglet.
 */
export function useBadges(initial: BadgeCounts): BadgeCounts {
  const pathname = usePathname();
  const [badges, setBadges] = useState(initial);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/badges", { cache: "no-store" });
        if (!response.ok) return;
        const fresh = (await response.json()) as BadgeCounts;
        if (alive) setBadges(fresh);
      } catch {
        // Réseau coupé : on garde les derniers compteurs connus.
      }
    };

    void load();
    const onVisible = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [pathname]);

  return badges;
}
