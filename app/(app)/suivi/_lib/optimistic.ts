import type { ProspectStatus } from "@/types";
import { nextAction } from "./next-action";
import type { ProspectRow } from "./rows";
import { stageOf } from "./stages";
import { CLOSES_REMINDERS } from "./write-status";

/** Statut affiché en attendant (ou à la place de) celui rendu par le serveur. */
export type StatusOverrides = Readonly<Record<string, ProspectStatus>>;

/**
 * Ligne telle qu'elle sera APRÈS l'écriture : colonne, prochaine action et
 * relance recalculées avec les mêmes règles que le serveur (buildRows,
 * writeProspectStatus). La carte change donc de colonne sans aller-retour.
 */
export function withStatus(row: ProspectRow, status: ProspectStatus): ProspectRow {
  if (row.status === status) return row;
  const nextDueAt = CLOSES_REMINDERS.has(status) ? null : row.nextDueAt;
  return {
    ...row,
    status,
    stageKey: stageOf(status).key,
    nextDueAt,
    action: nextAction({ status, draftsCount: row.draftsCount, nextDueAt }),
  };
}

/** Applique les statuts optimistes aux lignes du serveur. */
export function applyOverrides(rows: ProspectRow[], overrides: StatusOverrides): ProspectRow[] {
  if (!Object.keys(overrides).length) return rows;
  return rows.map((row) => (overrides[row.id] ? withStatus(row, overrides[row.id]) : row));
}

/** Copie sans l'entrée `id` : retour au statut rendu par le serveur. */
export function withoutOverride(overrides: StatusOverrides, id: string): StatusOverrides {
  if (!(id in overrides)) return overrides;
  const next = { ...overrides };
  delete next[id];
  return next;
}
