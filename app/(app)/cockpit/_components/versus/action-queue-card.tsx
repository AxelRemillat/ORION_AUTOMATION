"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { markActionDone, snoozeAction } from "../../actions";
import type { QueueAction } from "../../_lib/queue";
import { ActionRow, type RowState } from "./action-row";
import { RoundCompleteOverlay } from "./round-complete-overlay";
import { ScoreCounter } from "./score-counter";
import { Sparks, type SparksHandle } from "./sparks";
import { Stage, Streak } from "./stage";

/**
 * « LES ACTIONS DU JOUR » — écran VERSUS.
 *
 * Une scène sombre posée dans une page claire : la carte ne suit pas le thème,
 * c'est le projecteur du Cockpit. Deux halos se font face, le centre reste
 * sombre pour que le texte y reste lisible.
 *
 * La logique est inchangée (`queue.ts`, `actions.ts`) : retrait optimiste, puis
 * confirmation serveur, et retour de la ligne si le serveur refuse.
 */

/** Le temps que l'éclair passe et que la ligne se replie. */
const EXIT_MS = 450;
const OVERLAY_MS = 1800;

export function ActionQueueCard({ visible, total }: { visible: QueueAction[]; total: number }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [exiting, setExiting] = useState<Record<string, RowState>>({});
  const [done, setDone] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [pending, startTransition] = useTransition();
  // Le total du round est figé à l'ouverture : le score ne doit pas bouger
  // sous les pieds de l'utilisateur pendant qu'il coche.
  const [roundTotal] = useState(() => Math.max(total, visible.length, 1));

  const sparks = useRef<SparksHandle>(null);
  const router = useRouter();
  const toast = useToast();

  const rows = useMemo(
    () => visible.filter((action) => !removed.includes(action.id)),
    [visible, removed],
  );
  const intensity = rows.length ? Math.max(...rows.map((action) => action.heat)) : 0;
  const calm = rows.length === 0;

  function resolve(action: QueueAction, index: number, mode: "done" | "snooze") {
    setExiting((current) => ({ ...current, [action.id]: mode === "done" ? "done" : "snoozed" }));

    if (mode === "done") {
      sparks.current?.burst(0.78, 0.35 + index * 0.22);
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 300);
    }

    setTimeout(() => {
      setRemoved((current) => [...current, action.id]);
      if (mode === "done") {
        setDone((current) => {
          const next = current + 1;
          if (next >= roundTotal) {
            setOverlay(true);
            setTimeout(() => setOverlay(false), OVERLAY_MS);
          }
          return next;
        });
      }
    }, EXIT_MS);

    startTransition(async () => {
      const result =
        mode === "done" ? await markActionDone(action.id) : await snoozeAction(action.id);
      if (result.ok) {
        toast.success(mode === "done" ? "Action traitée." : "Reportée à demain.");
        router.refresh();
      } else {
        // Le serveur a refusé : la ligne revient, on ne ment pas sur l'état.
        setRemoved((current) => current.filter((id) => id !== action.id));
        setExiting((current) => ({ ...current, [action.id]: "idle" }));
        if (mode === "done") setDone((current) => Math.max(0, current - 1));
        toast.error(result.error);
      }
    });
  }

  return (
    <section
      aria-label="Actions du jour"
      className="relative overflow-hidden rounded-2xl shadow-overlay"
      style={{ background: "var(--vs-stage)", color: "var(--vs-ink)" }}
    >
      <Stage calm={calm} />

      <Sparks ref={sparks} intensity={calm ? 0.15 : intensity} />
      {overlay && <RoundCompleteOverlay total={roundTotal} />}

      {/* Decor en z-0, contenu en z-10 : aucune couche decorative ne peut
          repasser au-dessus des lignes et les delaver. */}
      <div className="relative z-10 p-5 md:p-6">
        {/* Mobile : le score passe au-dessus du titre. */}
        <div className="flex flex-col items-center gap-3 md:flex-row md:items-center md:justify-between">
          <div className="order-2 min-w-0 flex-1 md:order-1">
            <Streak />
            <h2
              className="font-versus my-2 text-center text-[clamp(26px,5vw,42px)] font-extrabold italic uppercase leading-none tracking-[-0.02em] md:text-left"
              style={{
                textShadow: "-1px 0 rgb(var(--rgb-vs-red) / 0.45), 1px 0 rgb(var(--rgb-vs-blue) / 0.45)",
              }}
            >
              Les actions du jour
            </h2>
            <Streak />
          </div>
          <div className="order-1 md:order-2 md:pl-6">
            <ScoreCounter done={done} total={roundTotal} celebrate={celebrate} />
          </div>
        </div>

        {calm ? (
          <p className="mt-5 text-center text-[15px] font-medium md:text-left">
            {total > 0
              ? `+${total} action${total > 1 ? "s" : ""} encore en file.`
              : "File vide, reviens demain."}
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-2.5">
            {rows.map((action, index) => (
              <ActionRow
                key={action.id}
                action={action}
                state={exiting[action.id] ?? "idle"}
                disabled={pending}
                onDone={() => resolve(action, index, "done")}
                onSnooze={() => resolve(action, index, "snooze")}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
