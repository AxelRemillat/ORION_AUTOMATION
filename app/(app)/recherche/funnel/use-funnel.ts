"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startJob } from "@/lib/jobs/client";
import type { FunnelSnapshot } from "@/lib/funnel/latest";

/**
 * Suivi du dernier run de l'entonnoir, par sondage : toutes les 2 s tant que
 * le job tourne (les cartes apparaissent au fil du creusage), toutes les 30 s
 * sinon (le run quotidien de 6 h peut démarrer pendant que l'écran est ouvert).
 */
export function useFunnel(enabled = true) {
  const [snapshot, setSnapshot] = useState<FunnelSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** Incrémenté au lancement : le sondage repart aussitôt à 2 s. */
  const [wake, setWake] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const read = useCallback(async () => {
    try {
      const response = await fetch("/api/funnel", { cache: "no-store" });
      const body = (await response.json()) as FunnelSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Lecture impossible.");
      setSnapshot(body);
      setError(null);
      return body;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lecture impossible.");
      return null;
    }
  }, []);

  const active = snapshot?.job?.status === "queued" || snapshot?.job?.status === "running";

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = async () => {
      const current = document.hidden ? null : await read();
      if (cancelled) return;
      const running = current?.job?.status === "queued" || current?.job?.status === "running";
      timer.current = setTimeout(tick, running ? 2_000 : 30_000);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, read, wake]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      // Les réglages enregistrés font foi : le job les relit à chaque étape.
      await startJob("search_signals", { label: "Signaux · entonnoir" }, { kind: "funnel" });
      setWake((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lancement impossible.");
    } finally {
      setStarting(false);
    }
  }

  return { snapshot, error, active, starting, start };
}
