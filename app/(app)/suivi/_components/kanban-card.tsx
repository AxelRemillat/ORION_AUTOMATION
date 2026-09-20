"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, PenLine } from "lucide-react";
import { formatDate, formatEur } from "@/lib/utils";
import type { ActionUrgency } from "../_lib/next-action";
import type { ProspectRow } from "../_lib/rows";

/** Couleur de la pastille « prochaine action », en tokens sémantiques. */
const URGENCY_TOKEN: Record<ActionUrgency, string> = {
  due: "var(--warn)",
  soon: "var(--primary)",
  idle: "var(--faint)",
  done: "var(--good)",
};

/**
 * Carte d'un prospect dans le Kanban : identité, valeur, prochaine action.
 * Déplaçable à la souris (HTML5) et au clavier via les deux chevrons, qui
 * restent la seule voie accessible — le glisser-déposer ne l'est pas.
 */
export function KanbanCard({
  row,
  dragging,
  canMoveLeft,
  canMoveRight,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  row: ProspectRow;
  dragging: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group rounded-lg border border-line bg-surface p-3 shadow-mist transition-[opacity,transform,border-color] hover:border-primary/45 motion-reduce:transition-none ${
        dragging ? "scale-[0.98] opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/suivi/${row.id}`}
          className="text-[13px] font-medium leading-snug text-text hover:text-primary"
        >
          {row.company_name}
        </Link>
        <span
          className="font-data shrink-0 text-[11px] text-muted"
          title={row.value.basis}
          aria-label={`${row.value.basis} : ${formatEur(row.value.amount)}`}
        >
          {formatEur(row.value.amount)}
        </span>
      </div>

      <p className="mt-0.5 truncate text-[12px] text-faint">
        {[row.sector, row.city].filter(Boolean).join(" · ") || "—"}
      </p>

      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: URGENCY_TOKEN[row.action.urgency] }}
          aria-hidden
        />
        <span className="truncate">{row.action.label}</span>
        {row.action.dueAt && (
          <span className="font-data shrink-0 text-[11px] text-faint">
            {formatDate(row.action.dueAt)}
          </span>
        )}
      </p>

      <footer className="mt-2.5 flex items-center gap-2 text-[11px] text-faint">
        {row.draftsCount > 0 && (
          <span className="inline-flex items-center gap-1 text-warn-ink">
            <PenLine className="h-3 w-3" aria-hidden />
            {row.draftsCount}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden />
          {formatDate(row.lastActivity)}
        </span>

        {/* Déplacement au clavier : visible au focus et au survol de la carte. */}
        <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none">
          <button
            type="button"
            disabled={!canMoveLeft}
            onClick={() => onMove(-1)}
            aria-label={`Reculer ${row.company_name} d'une étape`}
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            disabled={!canMoveRight}
            onClick={() => onMove(1)}
            aria-label={`Avancer ${row.company_name} d'une étape`}
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </span>
      </footer>
    </article>
  );
}
