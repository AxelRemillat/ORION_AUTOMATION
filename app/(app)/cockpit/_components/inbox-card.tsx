import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { InboundCategory } from "@/types";
import type { PendingInbound } from "../_lib/types";

/**
 * « Réponses reçues » — la seule section du Cockpit qui sorte du bleu-cyan.
 *
 * Choix délibéré : tout le reste de l'app est une aide à la décision, ce bloc
 * est une DETTE. Quelqu'un attend une réponse. Le registre chaud (ambre →
 * corail) le sépare visuellement du reste et le rend impossible à survoler
 * sans le voir. Les couleurs viennent des tokens sémantiques `--warn` /
 * `--lost`, jamais de valeurs en dur.
 */

/** Chaque catégorie porte sa propre charge : une question n'est pas un refus. */
const CATEGORY_STYLE: Record<InboundCategory, { label: string; className: string }> = {
  reponse: { label: "Réponse", className: "border-good/30 bg-good/10 text-good-ink" },
  question: { label: "Question", className: "border-primary/30 bg-primary/10 text-primary-ink" },
  relance: { label: "Relance", className: "border-warn/30 bg-warn/10 text-warn-ink" },
  refus: { label: "Refus", className: "border-lost/30 bg-lost/10 text-lost-ink" },
  autre: { label: "À lire", className: "border-line bg-surface-2 text-muted" },
};

function CategoryBadge({ category }: { category: InboundCategory }) {
  const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.autre;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function InboxCard({ items }: { items: PendingInbound[] }) {
  if (!items.length) return null;

  return (
    <section
      className="shadow-mist relative overflow-hidden rounded-xl border"
      style={{ borderColor: "rgb(var(--rgb-warn) / 0.45)", background: "var(--warn-soft)" }}
    >
      {/* Dégradé chaud : la signature de marque est cyan, celle-ci ne l'est pas. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{
          background: "linear-gradient(90deg, rgb(var(--rgb-warn)), rgb(var(--rgb-lost)))",
        }}
      />

      <div className="flex items-center gap-2 px-5 pb-1 pt-5">
        <Inbox className="h-4 w-4 text-warn-ink" aria-hidden />
        <h2 className="text-[15px] font-semibold tracking-tight text-text">Réponses reçues</h2>
        <span className="font-data ml-auto rounded-full border border-warn/30 bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn-ink">
          {items.length}
        </span>
      </div>
      <p className="px-5 pb-3 text-[12px] text-muted">
        {items.length > 1 ? "Ces personnes attendent" : "Cette personne attend"} une réponse.
      </p>

      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/cockpit/inbox/${item.id}`}
              className="group flex items-start gap-3 border-t px-5 py-3.5 motion-safe:transition-colors"
              style={{ borderColor: "rgb(var(--rgb-warn) / 0.22)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-text">{item.label}</span>
                  <CategoryBadge category={item.category} />
                  {/* L'adresse n'est rappelée que si elle n'est pas déjà le titre. */}
                  {item.label !== item.fromEmail && (
                    <span className="font-data truncate text-[11px] text-faint">
                      {item.fromEmail}
                    </span>
                  )}
                </div>

                {item.subject && (
                  <p className="mt-0.5 truncate text-[12px] font-medium text-muted">
                    {item.subject}
                  </p>
                )}
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted">
                  {item.excerpt}
                </p>
                <p className="font-data mt-1 text-[11px] text-faint">
                  {formatDateTime(item.receivedAt)}
                </p>
              </div>

              <ArrowUpRight
                className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink opacity-0 motion-safe:transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
