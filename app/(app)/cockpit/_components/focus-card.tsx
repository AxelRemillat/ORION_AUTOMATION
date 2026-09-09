import Link from "next/link";
import { ArrowUpRight, Target } from "lucide-react";
import { ExampleTag } from "../../recherche/signal-chip";
import type { FocusAction } from "../_lib/types";

/**
 * « 3 actions du jour ».
 *
 * Il n'existe pas de table de tâches : la liste est DÉDUITE de l'état réel du
 * pipeline (relances dues, réponses en attente, brouillons prêts). Quand la base
 * ne permet encore aucune déduction, on montre des exemples explicitement
 * étiquetés — jamais mélangés à des actions réelles.
 */
const URGENCY_COLOR: Record<FocusAction["urgency"], string> = {
  haute: "var(--warn)",
  moyenne: "var(--primary)",
  basse: "var(--faint)",
};

export function FocusCard({
  actions,
  isExample,
}: {
  actions: FocusAction[];
  isExample: boolean;
}) {
  return (
    <section
      className="shadow-mist relative overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <div
        aria-hidden
        className="bg-brand-grad pointer-events-none absolute inset-x-0 top-0 h-0.5"
      />

      <div className="flex items-center gap-2 px-5 pb-3 pt-5">
        <Target className="h-4 w-4" aria-hidden style={{ color: "var(--primary)" }} />
        <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--text)" }}>
          Les 3 actions du jour
        </h2>
        {isExample && <ExampleTag />}
      </div>

      <ol className="flex flex-col">
        {actions.map((action, index) => (
          <li key={action.id}>
            <Link
              href={action.href}
              className="group flex items-start gap-3 border-t px-5 py-3.5 motion-safe:transition-colors"
              style={{ borderColor: "var(--line-soft)" }}
            >
              <span
                className="font-data mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary-ink"
              >
                {index + 1}
              </span>

              <span className="flex-1">
                <span className="block text-sm font-medium" style={{ color: "var(--text)" }}>
                  {action.title}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[12px]">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: URGENCY_COLOR[action.urgency] }}
                  />
                  <span style={{ color: "var(--muted)" }}>{action.reason}</span>
                </span>
              </span>

              <ArrowUpRight
                className="mt-0.5 h-4 w-4 shrink-0 opacity-0 motion-safe:transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden
                style={{ color: "var(--primary)" }}
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
