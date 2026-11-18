"use client";

import { useState, useTransition } from "react";
import { Button, Modal, useToast } from "@/components/ui";
import type { YieldPlan } from "@/lib/today/yield";
import { yieldTodayToRelances } from "../actions";

/**
 * « Céder la place aux relances » (Cowork #42). Visible seulement quand le
 * plafond du jour est engagé ET que des relances validées attendent. Le clic
 * montre d'abord les intros qui seraient décalées ; rien ne bouge sans
 * « Décaler ». Jamais automatique.
 */

const at = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function YieldButton({ plan, onDone }: { plan: YieldPlan; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  if (!plan.show) return null;
  const count = plan.moves.length;

  const confirm = () =>
    start(async () => {
      const result = await yieldTodayToRelances(plan.moves.map((move) => move.messageId));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.moved} intro(s) décalée(s) au jour ouvré suivant${result.skipped ? ` · ${result.skipped} déjà partie(s) ou annulée(s)` : ""}. Programmez maintenant les relances.`);
      setOpen(false);
      onDone();
    });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} title={`${plan.relancesWaiting} relance(s) validée(s) sans créneau aujourd'hui`}>
        Céder la place aux relances
      </Button>
      <Modal
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        title="Céder la place aux relances"
        description={`${plan.relancesWaiting} relance(s) validée(s) n'ont plus de créneau aujourd'hui. Une relance dans un fil ouvert vaut mieux qu'une intro neuve : ces ${count} intro(s) programmée(s), les plus tardives du jour, passeraient en tête du ${at(`${plan.nextDay}T10:00:00Z`).split(" ").slice(0, 2).join(" ")}. Leur texte ne change pas, seul leur créneau bouge.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button onClick={confirm} loading={pending}>
              Décaler {count} intro{count > 1 ? "s" : ""}
            </Button>
          </>
        }
      >
        <ul className="flex flex-col divide-y divide-line-soft rounded-lg border border-line">
          {plan.moves.map((move) => (
            <li key={move.messageId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <span className="min-w-0 truncate text-text">{move.companyName}</span>
              <span className="font-data text-[12px] text-muted">
                {at(move.from)} → <span className="text-text">{at(move.to)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-muted">Après le décalage, programmez les relances : les créneaux libérés leur reviennent.</p>
      </Modal>
    </>
  );
}
