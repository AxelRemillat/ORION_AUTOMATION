"use client";

import { Button } from "@/components/ui";
import { DISCARD_REASONS, DISCARD_REASON_LABELS, type DiscardReason } from "@/types";

/**
 * « Pourquoi écarter ? » — un clic par motif. Le motif est gardé
 * (`prospect_discards`) pour les statistiques de l'entonnoir ; « Opposé »
 * passe aussi la fiche en « ne plus contacter ». Touches 1 à 5.
 */
export function DiscardReasons({ onPick, onCancel }: { onPick: (reason: DiscardReason) => void; onCancel: () => void }) {
  return (
    <div
      role="group"
      aria-label="Pourquoi écarter ?"
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-warn/25 bg-warn/10 px-3 py-2"
      onKeyDown={(event) => {
        const reason = DISCARD_REASONS[Number(event.key) - 1];
        if (reason) onPick(reason);
      }}
    >
      <span className="mr-1 text-[12px] font-medium text-warn-ink">Pourquoi écarter ?</span>
      {DISCARD_REASONS.map((reason, index) => (
        <Button key={reason} size="sm" variant="outline" autoFocus={index === 0} onClick={() => onPick(reason)}>
          <span className="font-data text-[10px] text-faint">{index + 1}</span> {DISCARD_REASON_LABELS[reason]}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Annuler
      </Button>
    </div>
  );
}
