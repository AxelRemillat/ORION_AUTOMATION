"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Clock } from "lucide-react";
import { useToast } from "@/components/ui";
import { markActionDone, snoozeAction } from "../actions";
import type { QueueAction } from "../_lib/queue";
import { Flames, type FlamesHandle } from "./flames";

/**
 * « Les actions du jour » — tête d'une file unique, trois à la fois.
 *
 * Le bloc est délibérément le plus voyant du Cockpit : dégradé chaud, flammes
 * dont l'intensité suit l'urgence réelle de la première action. Quand une
 * action sort, la suivante prend sa place — d'où le retrait optimiste local,
 * avant même que le serveur ait répondu.
 */
export function ActionQueue({ visible, total }: { visible: QueueAction[]; total: number }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [hover, setHover] = useState(false);
  const [pending, startTransition] = useTransition();
  const flames = useRef<FlamesHandle>(null);
  const router = useRouter();
  const toast = useToast();

  const rows = useMemo(
    () => visible.filter((action) => !removed.includes(action.id)),
    [visible, removed],
  );

  // La flamme suit l'action la plus urgente encore affichée.
  const intensity = rows.length ? Math.max(...rows.map((action) => action.heat)) : 0;

  function resolve(action: QueueAction, index: number, mode: "done" | "snooze") {
    // Étincelles à hauteur de la ligne validée, dans le canvas commun.
    flames.current?.burst(0.5, 0.25 + index * 0.25);
    setRemoved((current) => [...current, action.id]);

    startTransition(async () => {
      const result =
        mode === "done" ? await markActionDone(action.id) : await snoozeAction(action.id);
      if (result.ok) {
        toast.success(mode === "done" ? "Action traitée." : "Reportée à demain.");
        router.refresh();
      } else {
        // Le serveur a refusé : la ligne revient, on ne ment pas sur l'état.
        setRemoved((current) => current.filter((id) => id !== action.id));
        toast.error(result.error);
      }
    });
  }

  return (
    <section
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative overflow-hidden rounded-2xl shadow-overlay"
      style={{ background: "var(--flame-grad)", color: "var(--flame-ink)" }}
      aria-label="Actions du jour"
    >
      <Flames ref={flames} intensity={intensity} hover={hover} />

      <div className="relative p-5 md:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[19px] font-semibold tracking-tight">
            Les actions du jour
          </h2>
          <p className="font-data text-[12px]" style={{ color: "var(--flame-ink-soft)" }}>
            {rows.length > 0
              ? `${rows.length} sur ${Math.max(total, rows.length)} action${total > 1 ? "s" : ""} en attente`
              : "file vide"}
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="mt-5 text-[15px] font-medium">
            Tout est traité pour aujourd&apos;hui 🔥
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {rows.map((action, index) => (
              <li
                key={action.id}
                className="animate-slide-up rounded-xl px-3.5 py-3 backdrop-blur-[2px]"
                style={{
                  background: `rgba(0, 0, 0, ${0.18 + action.heat * 0.14})`,
                  border: "1px solid var(--flame-line)",
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    {/* Braise : plus l'action est urgente, plus elle est vive. */}
                    <span
                      aria-hidden
                      className="h-8 w-1 shrink-0 rounded-full"
                      style={{
                        background: "var(--flame-ink)",
                        opacity: 0.25 + action.heat * 0.7,
                      }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{action.title}</p>
                      <p className="text-[12px]" style={{ color: "var(--flame-ink-soft)" }}>
                        {action.reason}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Link
                      href={action.href}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold motion-safe:transition-colors"
                      style={{ background: "var(--flame-ink)", color: "#7e1259" }}
                    >
                      {action.cta}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => resolve(action, index, "done")}
                      title="Marquer comme fait"
                      aria-label={`Marquer « ${action.title} » comme fait`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border disabled:opacity-50"
                      style={{ borderColor: "var(--flame-line)" }}
                    >
                      <Check className="h-4 w-4" aria-hidden />
                    </button>

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => resolve(action, index, "snooze")}
                      title="Reporter à demain"
                      aria-label={`Reporter « ${action.title} » à demain`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border disabled:opacity-50"
                      style={{ borderColor: "var(--flame-line)" }}
                    >
                      <Clock className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
