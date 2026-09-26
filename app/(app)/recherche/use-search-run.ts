"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readProgress } from "@/lib/search/runs";
import type { SearchRun } from "@/types";

/**
 * Suivi du dernier scan, par sondage.
 *
 * Deux cadences volontairement differentes : l'ecran de recherche regarde
 * chaque seconde, le bandeau de navigation toutes les cinq. Un bandeau n'a pas
 * besoin d'etre au dixieme pres, et il est monte sur TOUTES les pages.
 *
 * Le sondage s'arrete de lui-meme des que le scan n'est plus en cours, et
 * pendant que l'onglet est cache : inutile d'interroger la base pour un ecran
 * que personne ne regarde.
 */
export function useSearchRun(pollMs: number, enabled = true) {
  const [run, setRun] = useState<SearchRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const read = useCallback(async (): Promise<SearchRun | null> => {
    try {
      const response = await fetch("/api/search/runs", { cache: "no-store" });
      if (!response.ok) return null;
      const body = (await response.json()) as { run: SearchRun | null };
      setRun(body.run);
      return body.run;
    } catch {
      // Reseau coupe : on garde le dernier etat connu plutot que de vider
      // l'ecran, et le prochain tour reessaiera.
      return null;
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      const current = document.hidden ? null : await read();
      if (cancelled) return;
      // On continue tant qu'un scan tourne, ou tant qu'on n'en sait rien.
      const again = document.hidden || !current || current.status === "running";
      timer.current = setTimeout(tick, again ? pollMs : pollMs * 10);
    };

    void tick();
    const onVisible = () => {
      if (!document.hidden) void read();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, pollMs, read]);

  return { run, loaded, refresh: read };
}

export { readProgress };
