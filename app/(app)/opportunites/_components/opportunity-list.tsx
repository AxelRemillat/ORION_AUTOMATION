import { Badge, Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/utils";
import { PLATFORM_LABELS, type Opportunity } from "@/lib/opportunities/types";
import { comeupKind, statusLabel } from "@/lib/opportunities/platform-style";
import { ageLabel, BUCKET_LABELS, SIZE_BADGE, sizeFlag } from "@/lib/opportunities/view";
import type { Filter, PlatformTab } from "@/lib/opportunities/tabs";
import { LaneBadges } from "./lane-badges";

export const scoreTone = (score: number | null) => (score == null ? "neutral" : score >= 8 ? "success" : score >= 5 ? "warning" : "danger");

const STATE_LABELS: Partial<Record<NonNullable<Opportunity["analysis_state"]>, string>> = {
  pending: " · analyse en cours",
  a_analyser: " · à analyser",
  non_analysee: " · non analysée",
  titre_seul: " · titre seul",
};

/** Liste des fiches de l'onglet, filtrée. */
export function OpportunityList({ shown, filter, tab, selectedId, onSelect }: { shown: Opportunity[]; filter: Filter; tab: PlatformTab; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <Card>
      <CardContent className="p-0">
        {shown.length === 0 ? (
          <p className="p-4 text-[13px] text-faint">{filter === "relances" ? "Aucune relance due : toutes les propositions envoyées ont une réponse ou sont récentes." : filter === "a_trier" ? "" : `Rien dans « ${BUCKET_LABELS[filter]} ».`}</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {shown.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={cn("pf-card flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-surface-2", item.id === selectedId && "bg-surface-2")}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-text">{item.title}</p>
                    <p className="truncate text-[12px] text-muted">
                      {PLATFORM_LABELS[item.platform]}
                      {item.published_at ? ` · ${ageLabel(item.published_at)}` : ""}
                      {item.budget ? ` · ${item.budget}` : ""}
                      {item.filter_reason ? ` · filtre : ${item.filter_reason}` : ""}
                      {(item.analysis_state && STATE_LABELS[item.analysis_state]) || ""}
                    </p>
                  </div>
                  {tab === "comeup" && <span className="pf-chip shrink-0 rounded-full px-2 py-0.5 text-[11px]">{comeupKind(item.status)}</span>}
                  <LaneBadges item={item} />
                  {sizeFlag(item) && (
                    <span title={`${SIZE_BADGE} : ${sizeFlag(item)}`} className="shrink-0 rounded-full border border-warn/45 bg-warn/15 px-2 py-0.5 text-[11px] text-warn-ink">
                      Trop gros seul
                    </span>
                  )}
                  {item.fit_score != null && item.analysis_state !== "titre_seul" && <Badge tone={scoreTone(item.fit_score)}>{item.fit_score}/10</Badge>}
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{statusLabel(item.status, tab)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
