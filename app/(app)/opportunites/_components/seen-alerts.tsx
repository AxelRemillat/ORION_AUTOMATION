import { Eye } from "lucide-react";
import type { Opportunity } from "@/lib/opportunities/types";
import { ageLabel } from "@/lib/opportunities/view";

/** « Alertes vues » : repliées par défaut, sous la liste ; elles ne reviennent jamais dans « Nouvelles alertes ». */
export function SeenAlerts({ alerts, onSelect }: { alerts: Opportunity[]; onSelect: (id: string) => void }) {
  if (!alerts.length) return null;
  return (
    <details className="rounded-xl border border-line bg-surface p-3 text-[13px]">
      <summary className="flex cursor-pointer items-center gap-2 text-muted">
        <Eye className="h-4 w-4" aria-hidden /> Alertes vues <span className="font-data">{alerts.length}</span>
      </summary>
      <ul className="mt-2 divide-y divide-line-soft">
        {alerts.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onSelect(item.id)} className="pf-card flex w-full items-center gap-2 py-2 pl-3 text-left hover:bg-surface-2">
              <span className="min-w-0 flex-1 truncate text-text">{item.title}</span>
              <span className="shrink-0 font-data text-[11px] text-faint">{ageLabel(item.published_at ?? item.created_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
