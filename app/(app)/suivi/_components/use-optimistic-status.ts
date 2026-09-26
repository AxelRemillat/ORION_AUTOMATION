"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui";
import type { ProspectStatus } from "@/types";
import { applyOverrides, withoutOverride, type StatusOverrides } from "../_lib/optimistic";
import type { ProspectRow } from "../_lib/rows";

type Result = { ok: true } | { ok: false; error: string };

/** Écriture en arrière-plan. `keepalive` : elle survit à un changement de page. */
async function sendStatus(id: string, status: ProspectStatus): Promise<Result> {
  try {
    const response = await fetch("/api/suivi/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
      keepalive: true,
    });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `Erreur ${response.status}` };
  } catch {
    return { ok: false, error: "Connexion perdue." };
  }
}

/**
 * Déplacement instantané des cartes du pipeline.
 *
 * La carte change de colonne AU MOMENT du dépôt ; l'écriture part ensuite, sans
 * rechargement ni refetch. En cas d'échec, la carte revient au dernier statut
 * confirmé par le serveur et un toast l'explique.
 *
 * Les écritures d'une même carte sont chaînées : déplacée deux fois de suite,
 * elle ne peut pas finir en base sur l'avant-dernière colonne parce que les
 * deux requêtes se seraient croisées.
 */
export function useOptimisticStatus(serverRows: ProspectRow[]) {
  const [overrides, setOverrides] = useState<StatusOverrides>({});
  const toast = useToast();

  const serverStatus = useRef(new Map<string, ProspectStatus>());
  const confirmed = useRef(new Map<string, ProspectStatus>());
  const latest = useRef(new Map<string, number>());
  const inFlight = useRef(new Map<string, number>());
  const chains = useRef(new Map<string, Promise<void>>());

  // Nouveau rendu serveur (relance soldée, retour sur la page…) : il fait foi
  // pour toute carte qui n'a plus d'écriture en cours.
  useEffect(() => {
    serverStatus.current = new Map(serverRows.map((row) => [row.id, row.status]));
    setOverrides((current) => {
      let next = current;
      for (const id of Object.keys(current)) {
        if (!inFlight.current.get(id)) {
          next = withoutOverride(next, id);
          confirmed.current.delete(id);
        }
      }
      return next;
    });
  }, [serverRows]);

  const move = useCallback(
    (row: ProspectRow, status: ProspectStatus, label: string) => {
      const { id } = row;
      if (!confirmed.current.has(id)) {
        confirmed.current.set(id, serverStatus.current.get(id) ?? row.status);
      }
      const seq = (latest.current.get(id) ?? 0) + 1;
      latest.current.set(id, seq);
      inFlight.current.set(id, (inFlight.current.get(id) ?? 0) + 1);
      setOverrides((current) => ({ ...current, [id]: status }));

      const previous = chains.current.get(id) ?? Promise.resolve();
      const chain = previous.then(async () => {
        const result = await sendStatus(id, status);
        inFlight.current.set(id, (inFlight.current.get(id) ?? 1) - 1);
        if (result.ok) {
          confirmed.current.set(id, status);
          return;
        }
        // Seul le dernier déplacement décide de ce qu'affiche la carte.
        if (latest.current.get(id) !== seq) return;
        const back = confirmed.current.get(id) ?? row.status;
        setOverrides((current) =>
          back === serverStatus.current.get(id) ? withoutOverride(current, id) : { ...current, [id]: back },
        );
        toast.error(`${row.company_name} n'a pas pu passer en « ${label} » : ${result.error}`);
      });
      chains.current.set(id, chain);
    },
    [toast],
  );

  const rows = useMemo(() => applyOverrides(serverRows, overrides), [serverRows, overrides]);
  return { rows, move };
}
