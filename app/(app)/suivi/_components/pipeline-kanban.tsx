"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { STAGES, STAGE_TONE_VARS, stageOf, statusForDrop, type Stage } from "../_lib/stages";
import { setProspectStatus } from "../actions";
import { KanbanCard } from "./kanban-card";
import type { ProspectRow } from "../_lib/rows";

/**
 * Kanban du pipeline. Le déplacement écrit le statut réel du prospect via la
 * même action serveur que la fiche : aucun état parallèle, donc rien à
 * resynchroniser. Pendant l'écriture, la colonne reste en attente plutôt que
 * de faire sauter la carte puis de la faire revenir en cas d'échec.
 */
export function PipelineKanban({ rows }: { rows: ProspectRow[] }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const move = (row: ProspectRow, stage: Stage) => {
    const status = statusForDrop(stage, row.status);
    if (!status || pending) return;

    setPendingId(row.id);
    startTransition(async () => {
      const result = await setProspectStatus(row.id, status);
      if (result.ok) {
        toast.success(`${row.company_name} → ${stage.label}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setPendingId(null);
    });
  };

  /** Déplacement clavier : d'une colonne vers la précédente ou la suivante. */
  const shift = (row: ProspectRow, direction: -1 | 1) => {
    const index = STAGES.findIndex((stage) => stage.key === stageOf(row.status).key);
    const target = STAGES[index + direction];
    if (target) move(row, target);
  };

  return (
    <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-3">
      {STAGES.map((stage, stageIndex) => {
        const tone = STAGE_TONE_VARS[stage.tone];
        const columnRows = rows.filter((row) => row.stageKey === stage.key);
        const isOver = overStage === stage.key && dragId !== null;

        return (
          <section
            key={stage.key}
            onDragOver={(event) => {
              event.preventDefault();
              setOverStage(stage.key);
            }}
            onDragLeave={() => setOverStage((current) => (current === stage.key ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              const row = rows.find((item) => item.id === dragId);
              setOverStage(null);
              setDragId(null);
              if (row) move(row, stage);
            }}
            className="flex w-[248px] shrink-0 flex-col gap-2"
            aria-label={`${stage.label} — ${columnRows.length} prospect(s)`}
          >
            <header className="px-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: tone.accent }} aria-hidden />
                <h3 className="text-[13px] font-medium text-text">{stage.label}</h3>
                <span className="font-data ml-auto text-[12px] text-faint">{columnRows.length}</span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-faint">{stage.hint}</p>
            </header>

            <div
              className="flex min-h-[120px] flex-1 flex-col gap-2 rounded-xl border border-dashed p-2 transition-colors motion-reduce:transition-none"
              style={{
                borderColor: isOver ? tone.accent : "var(--line)",
                background: isOver ? tone.soft : "var(--surface-2)",
              }}
            >
              {columnRows.map((row) => (
                <div key={row.id} className={pendingId === row.id ? "animate-pulse" : undefined}>
                  <KanbanCard
                    row={row}
                    dragging={dragId === row.id}
                    canMoveLeft={stageIndex > 0}
                    canMoveRight={stageIndex < STAGES.length - 1}
                    onDragStart={() => setDragId(row.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    onMove={(direction) => shift(row, direction)}
                  />
                </div>
              ))}

              {columnRows.length === 0 && (
                <p className="px-1 py-6 text-center text-[12px] text-faint">
                  {isOver ? "Déposer ici" : "Vide"}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
