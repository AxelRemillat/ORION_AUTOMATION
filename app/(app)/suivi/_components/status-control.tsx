"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Label, Select, useToast } from "@/components/ui";
import { PIPELINE_ORDER, PROSPECT_STATUS_META } from "@/lib/constants";
import type { ProspectStatus } from "@/types";
import { setProspectStatus } from "../actions";
import { DealModal } from "./deal-modal";

/**
 * Changement de statut du prospect. Choisir « Gagné » ouvre la saisie du
 * contrat : le statut est alors posé par l'enregistrement du deal.
 * Optimiste (Cowork #23) : le nouveau statut s'affiche tout de suite ; un refus du
 * serveur remet l'ancien et le dit.
 */
export function StatusControl({
  prospectId,
  status,
  hasDeal,
}: {
  prospectId: string;
  status: ProspectStatus;
  hasDeal: boolean;
}) {
  const [dealOpen, setDealOpen] = useState(false);
  // Statut affiché : celui choisi, en attendant la confirmation du serveur.
  const [optimistic, setOptimistic] = useState<ProspectStatus | null>(null);
  const shown = optimistic ?? status;
  // Le serveur a parlé (rafraîchissement) : sa valeur fait foi.
  useEffect(() => setOptimistic(null), [status]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const onChange = (next: ProspectStatus) => {
    if (next === shown) return;
    if (next === "gagne" && !hasDeal) {
      setDealOpen(true);
      return;
    }
    setOptimistic(next);
    startTransition(async () => {
      const result = await setProspectStatus(prospectId, next);
      if (result.ok) {
        toast.success(`Statut : ${PROSPECT_STATUS_META[next].label}.`);
        router.refresh();
      } else {
        setOptimistic(null);
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="w-full sm:w-56">
      <Label htmlFor="prospect-status">Statut</Label>
      <Select
        id="prospect-status"
        value={shown}
        aria-busy={pending}
        onChange={(event) => onChange(event.target.value as ProspectStatus)}
      >
        {PIPELINE_ORDER.map((value) => (
          <option key={value} value={value}>
            {PROSPECT_STATUS_META[value].label}
          </option>
        ))}
      </Select>
      <DealModal prospectId={prospectId} open={dealOpen} onClose={() => setDealOpen(false)} />
    </div>
  );
}
