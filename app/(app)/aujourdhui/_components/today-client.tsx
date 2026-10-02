"use client";

import { useCallback, useState } from "react";
import { Modal } from "@/components/ui";
import type { Capacity } from "@/lib/today/capacity";
import type { TodayItem } from "@/lib/today/types";
import { ScheduleSheet } from "./schedule-sheet";
import { TodayDock } from "./today-dock";
import { TodayHeader } from "./today-header";
import { TodayList } from "./today-list";
import { EDITOR_ID, TodayPane } from "./today-pane";
import { useTodayKeys } from "./use-today-keys";
import { useTodayState } from "./use-today-state";

/**
 * « Aujourd'hui » : la file préparée, à trier au clavier. Liste à gauche,
 * élément à droite, programmation groupée en bas.
 */

const SHORTCUTS: [string, string][] = [
  ["V", "Valider et passer au suivant"],
  ["X", "Écarter (puis 1 à 5 pour le motif)"],
  ["E", "Modifier le texte"],
  ["↓ / J", "Élément suivant"],
  ["↑ / K", "Élément précédent"],
  ["Échap", "Quitter le champ, fermer"],
  ["?", "Cette aide"],
];

export function TodayClient({
  today,
  items: initial,
  capacity,
  liveJobId,
  alert = null,
  dailyTarget,
  initialKey,
}: {
  today: string;
  items: TodayItem[];
  capacity: Capacity;
  liveJobId: string | null;
  /** Échec de la dernière préparation (job ou brouillons), à afficher en tête. */
  alert?: string | null;
  dailyTarget: number;
  /** `?item=` : élément ouvert d'emblée (lien depuis une fiche, une notification). */
  initialKey: string | null;
}) {
  const state = useTodayState(initial, initialKey);
  const { items, current } = state;
  const [discarding, setDiscarding] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [help, setHelp] = useState(false);
  const refresh = state.refresh;
  const onFinished = useCallback(() => refresh(), [refresh]);
  const locked = !current || current.status === "programme" || current.status === "envoye";

  useTodayKeys(
    {
      validate: () => current && !locked && current.messageId && void state.validate(current),
      discard: () => !locked && setDiscarding(true),
      edit: () => document.getElementById(EDITOR_ID)?.focus(),
      next: () => (setDiscarding(false), state.move(1)),
      previous: () => (setDiscarding(false), state.move(-1)),
      escape: () => (setDiscarding(false), setHelp(false)),
      help: () => setHelp(true),
    },
    !sheet,
  );

  const validated = items.filter((item) => item.status === "valide" && item.messageId).length;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TodayHeader today={today} items={items} capacity={capacity} liveJobId={liveJobId} alert={alert} dailyTarget={dailyTarget} onFinished={onFinished} />
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <TodayList items={items} selected={state.index} checked={state.checked} onSelect={(index) => (setDiscarding(false), state.setIndex(index))} onToggle={state.toggle} />
        {current && (
          <TodayPane
            key={current.key}
            item={current}
            draft={state.draftOf(current)}
            discarding={discarding}
            onEdit={(patch) => state.edit(current, patch)}
            onBlur={() => void state.save(current)}
            onValidate={(on) => void state.validate(current, on)}
            onDiscard={(reason) => (setDiscarding(false), void state.discard(current, reason))}
            onAskDiscard={() => setDiscarding(true)}
            onCancelDiscard={() => setDiscarding(false)}
            onRefresh={refresh}
          />
        )}
      </div>
      <TodayDock
        validated={validated}
        remaining={capacity.remaining}
        checked={state.checked.size}
        onValidateChecked={() => void state.validateChecked()}
        onSchedule={() => setSheet(true)}
        onHelp={() => setHelp(true)}
      />
      <ScheduleSheet open={sheet} items={items} capacity={capacity} onClose={() => setSheet(false)} onDone={() => (setSheet(false), refresh())} />
      <Modal open={help} onClose={() => setHelp(false)} title="Raccourcis clavier" size="sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
          {SHORTCUTS.map(([key, label]) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-data text-[11px] text-text">{key}</kbd>
              </dt>
              <dd className="text-muted">{label}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </div>
  );
}
