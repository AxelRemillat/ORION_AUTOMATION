"use client";

import { useEffect, useRef, useState } from "react";
import type { PreflightResult } from "@/lib/mail-preflight";
import type { PreflightRequest } from "@/lib/mail-preflight/server";

/**
 * Contrôle avant envoi, relancé 1,2 s après la dernière frappe. Le verdict de
 * cohérence (LLM) est demandé en même temps : le serveur le met en cache par
 * empreinte objet + corps, un texte inchangé ne coûte donc rien.
 */
export function usePreflight(request: PreflightRequest, enabled = true) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(request);
  const latest = useRef(key);

  useEffect(() => {
    if (!enabled) return;
    latest.current = key;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/mail-preflight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...JSON.parse(key), coherence: true }),
        });
        const body = (await response.json()) as PreflightResult;
        if (latest.current === key && response.ok) setResult(body);
      } catch {
        // Réseau coupé : le serveur contrôle de toute façon au départ.
      } finally {
        if (latest.current === key) setLoading(false);
      }
    }, 1_200);
    return () => clearTimeout(timer);
  }, [key, enabled]);

  return { result, loading };
}
