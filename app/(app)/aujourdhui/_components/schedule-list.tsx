"use client";

import { useState } from "react";

/**
 * Liste du plan d'envoi (Cowork #50, 13/10/2026) : avec 52 mails, la fenêtre
 * dépassait l'écran et le bouton « Confirmer » devenait inaccessible. On montre
 * les 5 premiers, puis « Voir plus (N) » ; dépliée, la liste défile DANS la
 * fenêtre (le conteneur parent fixe la hauteur), jamais la page.
 */
export const SCHEDULE_PREVIEW = 5;

export interface ScheduleRow {
  key: string;
  company: string;
  type: string;
  when: string;
}

/** Lignes affichées : les 5 premières, ou toutes une fois dépliée. */
export function visibleRows<T>(rows: readonly T[], expanded: boolean): { shown: readonly T[]; hidden: number } {
  if (expanded || rows.length <= SCHEDULE_PREVIEW) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, SCHEDULE_PREVIEW), hidden: rows.length - SCHEDULE_PREVIEW };
}

export function ScheduleList({ rows, defaultExpanded = false }: { rows: readonly ScheduleRow[]; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { shown, hidden } = visibleRows(rows, expanded);
  return (
    <div data-schedule-list className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <table className="w-full text-[13px]">
        <tbody>
          {shown.map((row) => (
            <tr key={row.key} className="border-b border-line-soft">
              <td className="py-1.5 text-text">{row.company}</td>
              <td className="py-1.5 text-muted">{row.type}</td>
              <td className="whitespace-nowrap py-1.5 text-right font-data text-text">{row.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded(true)} className="mt-2 text-[13px] font-medium text-primary-ink hover:underline">
          Voir plus ({hidden})
        </button>
      )}
    </div>
  );
}
