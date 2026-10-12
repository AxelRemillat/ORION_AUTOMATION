"use client";

import { useMemo, useState } from "react";
import { Button, Modal, useToast } from "@/components/ui";
import { planDays } from "@/lib/today/plan";
import type { Capacity } from "@/lib/today/capacity";
import type { TodayItem } from "@/lib/today/types";
import { utcToParis } from "@/lib/outbox/paris-time";
import { scheduleToday } from "../actions";

/**
 * Feuille « Programmer les envois » : le plan AVANT confirmation — chaque mail
 * validé, son jour et son heure (9 h – 17 h, 2 à 7 min d'écart ; réponses,
 * puis relances, puis intros). Plusieurs jours ouvrés (Cowork #50) : chaque
 * jour se remplit jusqu'à SON plafond, envois déjà partis et programmés
 * déduits ; ce qui dépasse l'horizon reste validé. Le serveur revérifie tout.
 */

const TYPE = { intro: "Intro", relance: "Relance", reponse: "Réponse" } as const;
const HORIZONS = [
  { days: 1, label: "Aujourd'hui seulement" },
  { days: 3, label: "3 jours" },
  { days: 5, label: "5 jours" },
] as const;
const time = (at: Date) => at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const dayLabel = (day: string, today: string) =>
  day === today
    ? "Aujourd'hui"
    : new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).replace(/^./, (c) => c.toUpperCase());

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
  const [horizon, setHorizon] = useState<number>(5);
  const today = utcToParis(new Date()).date;
  const plan = useMemo(
    () => (open ? planDays({ items, days: capacity.days.slice(0, horizon), taken: capacity.taken.map((at) => new Date(at)) }) : null),
    [open, items, capacity, horizon],
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

  const count = plan?.planned.length ?? 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Programmer les envois"
      description="Réparti sur les jours ouvrés, entre 9 h et 17 h, 2 à 7 min d'écart, sans dépasser le plafond de chaque jour."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={confirm} loading={busy} disabled={!count}>
            Confirmer {count} envoi(s)
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Horizon" className="mb-3 flex flex-wrap gap-1.5">
        {HORIZONS.map((option) => (
          <Button key={option.days} size="sm" variant={horizon === option.days ? "secondary" : "ghost"} role="radio" aria-checked={horizon === option.days} onClick={() => setHorizon(option.days)}>
            {option.label}
          </Button>
        ))}
      </div>
      {plan && (
        <p className="mb-3 font-data text-[12px] leading-5 text-muted">
          {plan.days.map((room) => (
            <span key={room.day} className="mr-2 inline-block whitespace-nowrap" title={`Plafond ${room.cap}, déjà engagés ${room.used}`}>
              {dayLabel(room.day, today)} : <span className="text-text">{room.planned}</span>
            </span>
          ))}
        </p>
      )}
      <table className="w-full text-[13px]">
        <tbody>
          {plan?.planned.map((entry) => (
            <tr key={entry.key} className="border-b border-line-soft">
              <td className="py-1.5 text-text">{byKey.get(entry.key)?.companyName}</td>
              <td className="py-1.5 text-muted">{TYPE[byKey.get(entry.key)?.messageType ?? "intro"]}</td>
              <td className="whitespace-nowrap py-1.5 text-right font-data text-text">
                {dayLabel(entry.day, today)} {time(entry.at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan && plan.postponed.length > 0 && (
        <p className="mt-3 text-[12px] text-warn-ink">
          {plan.postponed.length} mail(s) au-delà des plafonds de l&apos;horizon choisi : ils restent validés et reviennent en tête de file.
        </p>
      )}
      <p className="mt-2 text-[12px] text-muted">Les relances J+4 et J+7 seront préparées automatiquement. Retirer la validation d&apos;un mail programmé libère sa place.</p>
    </Modal>
  );
}
