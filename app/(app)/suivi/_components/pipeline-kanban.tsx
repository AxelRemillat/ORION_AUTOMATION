"use client";

import { useState } from "react";
import type { ProspectStatus } from "@/types";
import { STAGES, STAGE_TONE_VARS, stageOf, statusForDrop, type Stage } from "../_lib/stages";
import { ColumnCards } from "./column-cards";
import type { ProspectRow } from "../_lib/rows";

/**
 * Kanban du pipeline. Le dépôt est optimiste (use-optimistic-status) : la
 * carte change de colonne immédiatement, l'écriture part en arrière-plan et
 * n'est annulée à l'écran qu'en cas d'échec. Aucun verrou global : on peut
 * enchaîner les déplacements sans attendre le serveur.
 */
export function PipelineKanban({
  rows,
  onMove,
}: {
  rows: ProspectRow[];
  onMove: (row: ProspectRow, status: ProspectStatus, label: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const move = (row: ProspectRow, stage: Stage) => {
    const status = statusForDrop(stage, row.status);
    if (status) onMove(row, status, stage.label);
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
        /*
         * La plus récente activité en haut : c'est l'ordre dans lequel on
         * reprend un dossier. Une fiche sans activité passe après, à sa date
         * de création près (lastActivity vaut alors created_at).
         */
        const columnRows = rows
          .filter((row) => row.stageKey === stage.key)
          .sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
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
              <ColumnCards
                rows={columnRows}
                stageIndex={stageIndex}
                stageCount={STAGES.length}
                dragId={dragId}
                isOver={isOver}
                onDragStart={(row) => setDragId(row.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setOverStage(null);
                }}
                onShift={shift}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
