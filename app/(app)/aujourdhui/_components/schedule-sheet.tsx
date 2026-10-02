"use client";

import { useMemo, useState } from "react";
import { Button, Modal, useToast } from "@/components/ui";
import { planSchedule } from "@/lib/today/plan";
import type { Capacity } from "@/lib/today/capacity";
import type { TodayItem } from "@/lib/today/types";
import { scheduleToday } from "../actions";

/**
 * Feuille « Programmer les envois » : le plan AVANT confirmation — chaque mail
 * validé, son type et son heure (9 h – 17 h, 2 à 7 min d'écart ; réponses,
 * puis relances, puis intros) ; ce qui dépasse le plafond reste validé et
 * revient demain. Le serveur revérifie tout à la confirmation.
 */

const TYPE = { intro: "Intro", relance: "Relance", reponse: "Réponse" } as const;
const time = (at: Date) => at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

export function ScheduleSheet({
  open,
  items,
  capacity,
  onClose,
  onDone,
}: {
  open: boolean;
  items: TodayItem[];
  capacity: Capacity;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const plan = useMemo(
    () => (open ? planSchedule({ items, remaining: capacity.remaining, taken: capacity.taken.map((at) => new Date(at)) }) : null),
    [open, items, capacity],
  );
  const byKey = new Map(items.map((item) => [item.key, item]));

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    const result = await scheduleToday(plan.planned.map((entry) => ({ key: entry.key, at: entry.at.toISOString() })));
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    if (result.refused.length) toast.error(`${result.refused.length} refusé(s) : ${result.refused[0].error}`);
    if (result.scheduled) toast.success(`${result.scheduled} envoi(s) programmé(s).`);
    onDone();
  }

  const day = plan ? new Date(`${plan.day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Programmer les envois"
      description={`Envoi réparti ${day ? `le ${day}, ` : ""}entre 9 h et 17 h, 2 à 7 min d'écart.`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={confirm} loading={busy} disabled={!plan?.planned.length}>
            Confirmer {plan?.planned.length ?? 0} envoi(s)
          </Button>
        </>
      }
    >
      <table className="w-full text-[13px]">
        <tbody>
          {plan?.planned.map((entry) => (
            <tr key={entry.key} className="border-b border-line-soft">
              <td className="py-1.5 text-text">{byKey.get(entry.key)?.companyName}</td>
              <td className="py-1.5 text-muted">{TYPE[byKey.get(entry.key)?.messageType ?? "intro"]}</td>
              <td className="py-1.5 text-right font-data text-text">{time(entry.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan && plan.postponed.length > 0 && (
        <p className="mt-3 text-[12px] text-warn-ink">
          {plan.postponed.length} mail(s) au-delà du plafond ou de la fenêtre : ils restent validés et reviennent en tête de file au prochain jour ouvré.
        </p>
      )}
      <p className="mt-2 text-[12px] text-muted">Les relances J+4 et J+7 seront préparées automatiquement.</p>
    </Modal>
  );
}
