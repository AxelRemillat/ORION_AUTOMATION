"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { PIPELINE_ORDER, PROSPECT_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import type { ProspectRow } from "../_lib/rows";

/**
 * Vue colonnes : une colonne par statut du pipeline, cartes cliquables.
 * Lecture seule (le statut se change depuis la fiche) pour rester simple
 * et éviter une dépendance drag & drop.
 */
export function PipelineKanban({ rows }: { rows: ProspectRow[] }) {
  return (
    <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-2">
      {PIPELINE_ORDER.map((status) => {
        const columnRows = rows.filter((row) => row.status === status);
        return (
          <section key={status} className="flex w-64 shrink-0 flex-col gap-2">
            <header className="flex items-center gap-2 px-1">
              <span className="text-[13px] font-medium text-fg">
                {PROSPECT_STATUS_META[status].label}
              </span>
              <Badge tone="neutral">{columnRows.length}</Badge>
            </header>

            <div className="flex min-h-[80px] flex-col gap-2 rounded-lg border border-dashed border-border bg-surface/40 p-2">
              {columnRows.length === 0 && (
                <p className="px-1 py-3 text-center text-[12px] text-muted">Vide</p>
              )}
              {columnRows.map((row) => (
                <Link
                  key={row.id}
                  href={`/suivi/${row.id}`}
                  className="rounded border border-border bg-surface p-3 shadow-card transition-colors hover:border-accent/50"
                >
                  <p className="text-[13px] font-medium text-fg">{row.company_name}</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {[row.sector, row.city].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                    <span>{formatDate(row.lastActivity)}</span>
                    {row.draftsCount > 0 && <Badge tone="warning">{row.draftsCount} brouillon</Badge>}
                    {row.nextDueAt && <Badge tone="info">relance {formatDate(row.nextDueAt)}</Badge>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
