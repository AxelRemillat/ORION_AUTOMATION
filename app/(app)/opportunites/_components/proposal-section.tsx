import { RefreshCw, Send } from "lucide-react";
import { Button, Label, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { PLATFORM_LABELS, type Opportunity } from "@/lib/opportunities/types";
import { suggestedPrice } from "@/lib/opportunities/email/view";
import type { OpportunityActions } from "./use-opportunity-actions";

/** Proposition : note du relecteur, texte modifiable, prix et délai à saisir, « Marquer envoyée ». */
export function ProposalSection({ selected, actions }: { selected: Opportunity; actions: OpportunityActions }) {
  const { busy, patch, regenerate } = actions;
  const length = (selected.proposal ?? "").length;
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <Label>Proposition</Label>
        <div className="flex items-center gap-1.5">
          {selected.proposal_on_excerpt && (
            <span title="Rédigée sur l'extrait du flux RSS : collez l'annonce complète pour la régénérer." className="rounded-full border border-warn/25 bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn-ink">
              Brouillon sur extrait
            </span>
          )}
          {selected.proposal_score != null && (
            <span
              title={selected.proposal_reason ?? "Note du relecteur automatique (9 = à poster telle quelle)"}
              className={cn(
                "rounded-full border px-1.5 py-0.5 font-data text-[10px]",
                selected.proposal_score >= 9 ? "border-good/25 bg-good/10 text-good-ink" : "border-warn/25 bg-warn/10 text-warn-ink",
              )}
            >
              {selected.proposal_score}/10
            </span>
          )}
        </div>
      </div>
      {selected.proposal_reason && <p className="mb-1.5 text-[12px] text-warn-ink">À retravailler — {selected.proposal_reason}</p>}
      <Textarea
        key={`${selected.id}:${selected.updated_at}`}
        defaultValue={selected.proposal ?? ""}
        rows={12}
        onBlur={(event) => {
          if (event.target.value.trim() !== selected.proposal?.trim()) void patch(selected.id, { proposal: event.target.value }, "Proposition enregistrée.");
        }}
      />
      <p className={cn("mt-1 font-data text-[11px]", selected.platform === "upwork" && length > 1200 ? "text-lost-ink" : "text-faint")}>
        {length} caractères{selected.platform === "upwork" ? " / 1 200 (Upwork : la 1re phrase s'affiche en aperçu)" : ""}
      </p>
      {(selected.suggested_amount_eur != null || selected.suggested_delay_days != null) && (
        <p className="mt-1.5 text-[13px] text-text">
          À saisir sur {PLATFORM_LABELS[selected.platform]} :{" "}
          <span className="font-data">{suggestedPrice(selected.suggested_amount_eur, selected.suggested_currency ?? (selected.platform === "upwork" ? "USD" : "EUR"), selected.suggested_hourly)}</span> ·{" "}
          <span className="font-data">{selected.suggested_delay_days != null ? `${selected.suggested_delay_days} jours` : "—"}</span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={selected.status !== "a_repondre"}
          loading={busy === `patch:${selected.id}`}
          onClick={() => patch(selected.id, { status: "envoyee" }, "Marquée envoyée.")}
        >
          <Send className="h-3.5 w-3.5" aria-hidden /> Marquer envoyée
        </Button>
        <Button size="sm" variant="ghost" loading={busy === `regen:${selected.id}`} onClick={() => regenerate(selected.id)}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Régénérer
        </Button>
      </div>
    </div>
  );
}
