"use client";

import { KanbanCard } from "./kanban-card";
import { ShowMore, useShowMore } from "./show-more";
import type { ProspectRow } from "../_lib/rows";

/**
 * Les cartes d'UNE colonne, les plus récentes d'abord, dépliables par paquets.
 *
 * Composant à part parce que chaque colonne a son propre compteur : un hook
 * appelé dans la boucle des étapes serait un hook dans une boucle. Et ça garde
 * `pipeline-kanban` lisible.
 */
export function ColumnCards({
  rows,
  stageIndex,
  stageCount,
  dragId,
  isOver,
  onDragStart,
  onDragEnd,
  onShift,
  step = 10,
}: {
  rows: ProspectRow[];
  stageIndex: number;
  stageCount: number;
  dragId: string | null;
  isOver: boolean;
  onDragStart: (row: ProspectRow) => void;
  onDragEnd: () => void;
  onShift: (row: ProspectRow, direction: -1 | 1) => void;
  step?: number;
}) {
  const { visible, rest, more } = useShowMore(rows.length, step);

  if (rows.length === 0) {
    return <p className="px-1 py-6 text-center text-[12px] text-faint">{isOver ? "Déposer ici" : "Vide"}</p>;
  }

  return (
    <>
      {rows.slice(0, visible).map((row) => (
        <KanbanCard
          key={row.id}
          row={row}
          dragging={dragId === row.id}
          canMoveLeft={stageIndex > 0}
          canMoveRight={stageIndex < stageCount - 1}
          onDragStart={() => onDragStart(row)}
          onDragEnd={onDragEnd}
          onMove={(direction) => onShift(row, direction)}
        />
      ))}
      <ShowMore rest={rest} onMore={more} />
    </>
  );
}
