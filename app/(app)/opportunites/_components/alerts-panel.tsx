import { Bell, Copy } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { PLATFORM_LABELS, type Opportunity } from "@/lib/opportunities/types";
import { ageLabel } from "@/lib/opportunities/view";
import { OpenAdLink } from "./open-ad-link";
import type { OpportunityActions } from "./use-opportunity-actions";

/** « Nouvelles alertes » de l'onglet : score ≥ 8 non vues, avec ouverture et copie directes. */
export function AlertsPanel({ alerts, actions, onSelect }: { alerts: Opportunity[]; actions: OpportunityActions; onSelect: (id: string) => void }) {
  if (!alerts.length) return null;
  return (
    <section className="mb-6 rounded-xl border border-good/25 bg-good/5 p-3">
      <h2 className="mb-2 flex items-center gap-2 text-[14px] font-medium text-text">
        <Bell className="h-4 w-4 text-good-ink" aria-hidden /> Nouvelles alertes <span className="font-data text-good-ink">{alerts.length}</span>
      </h2>
      <ul className="space-y-2">
        {alerts.map((item) => (
          <li key={item.id} className="rounded-lg border border-line-soft bg-surface p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(item.id)}>
                <p className="text-[13px] font-medium text-text">{item.title}</p>
                <p className="text-[12px] text-muted">
                  {PLATFORM_LABELS[item.platform]} · {ageLabel(item.published_at ?? item.created_at)}
                  {item.budget ? ` · ${item.budget}` : ""}
                </p>
              </button>
              <Badge tone="success">{item.fit_score}/10</Badge>
            </div>
            <ul className="mt-1.5 list-disc pl-5 text-[12px] text-muted">
              {(item.fit_reasons ?? []).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <OpenAdLink item={item} onOpen={actions.markSeen} />
              <Button size="sm" disabled={!item.proposal} onClick={() => actions.copy(item)}>
                <Copy className="h-3.5 w-3.5" aria-hidden /> {item.proposal ? "Copier la proposition" : "Proposition en cours…"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
