import { Copy, PenLine, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import type { Opportunity } from "@/lib/opportunities/types";
import { PROPOSAL_BUTTON_LABELS, proposalButtonState } from "@/lib/opportunities/proposal-state";
import type { OpportunityActions } from "./use-opportunity-actions";

/**
 * Bouton de proposition (Cowork #21) : « Copier » si elle existe ; « en cours » seulement si
 * une rédaction tourne vraiment ; sinon « Rédiger la proposition » ou « Échec — réessayer ».
 */
export function ProposalButton({ item, actions }: { item: Opportunity; actions: OpportunityActions }) {
  const state = proposalButtonState(item, actions.busy === `regen:${item.id}`);
  if (state === "copier") {
    return (
      <Button size="sm" onClick={() => actions.copy(item)}>
        <Copy className="h-3.5 w-3.5" aria-hidden /> {PROPOSAL_BUTTON_LABELS.copier}
      </Button>
    );
  }
  const Icon = state === "echec" ? RefreshCw : PenLine;
  return (
    <Button
      size="sm"
      variant={state === "echec" ? "danger" : "outline"}
      disabled={state === "en_cours"}
      loading={state === "en_cours"}
      title={state === "echec" ? (item.proposal_reason ?? "La rédaction a échoué.") : undefined}
      onClick={() => actions.regenerate(item.id)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden /> {PROPOSAL_BUTTON_LABELS[state]}
    </Button>
  );
}
