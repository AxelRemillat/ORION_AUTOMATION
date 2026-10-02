"use client";

import { cn } from "@/lib/utils";
import { GROUP_LABELS, type TodayItem, type TodayStatus } from "@/lib/today/types";
import { TODAY_KINDS } from "@/types";

/**
 * Liste de gauche : quatre groupes, dans l'ordre de traitement, avec leur
 * en-tête collant « LIBELLÉ · N à faire ». L'ordre des lignes est celui de
 * ↓ / ↑ (les éléments arrivent déjà triés).
 */

const STATUS: Record<TodayStatus, { label: string; className: string }> = {
  todo: { label: "À relire", className: "border-line bg-surface-2 text-muted" },
  valide: { label: "Validé", className: "border-good/25 bg-good/10 text-good-ink" },
  ecarte: { label: "Écarté", className: "border-line-soft bg-surface-2/60 text-faint line-through" },
  programme: { label: "Programmé", className: "border-primary/25 bg-primary/10 text-primary-ink" },
  envoye: { label: "Envoyé", className: "border-teal/25 bg-teal/10 text-teal-ink" },
};

export function TodayList({
  items,
  selected,
  checked,
  onSelect,
  onToggle,
}: {
  items: TodayItem[];
  selected: number;
  checked: Set<string>;
  onSelect: (index: number) => void;
  onToggle: (key: string) => void;
}) {
  if (!items.length) {
    return (
      <p className="rounded-xl border border-line bg-surface p-6 text-[13px] text-muted">
        Rien à traiter pour l&apos;instant. La prochaine préparation remplira la file, ou lancez-la maintenant.
      </p>
    );
  }
  return (
    <div className="scrollbar-thin flex max-h-[calc(100vh-15rem)] flex-col overflow-y-auto rounded-xl border border-line bg-surface shadow-mist">
      {TODAY_KINDS.map((kind) => {
        const group = items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === kind);
        if (!group.length) return null;
        const todo = group.filter(({ item }) => item.status === "todo").length;
        return (
          <section key={kind} aria-label={GROUP_LABELS[kind]}>
            <h2 className="sticky top-0 z-10 border-b border-line-soft bg-surface-2 px-3 py-1.5 font-data text-[11px] uppercase tracking-wide text-muted">
              {GROUP_LABELS[kind]} · {todo} à faire
            </h2>
            <ul>
              {group.map(({ item, index }) => (
                <li key={item.key}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-current={index === selected}
                    onClick={() => onSelect(index)}
                    onKeyDown={(event) => event.key === "Enter" && onSelect(index)}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 border-b border-line-soft px-3 py-2.5 hover:bg-surface-2/60",
                      index === selected && "bg-primary/5 shadow-[inset_3px_0_0_var(--primary)]",
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${item.companyName}`}
                      className="mt-1"
                      checked={checked.has(item.key)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => onToggle(item.key)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-[13px] font-medium text-text", item.status === "ecarte" && "text-faint line-through")}>
                        {item.companyName}
                      </p>
                      <p className="truncate text-[12px] text-muted">{item.subline || item.tags.join(" · ")}</p>
                    </div>
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px]", STATUS[item.status].className)}>
                      {STATUS[item.status].label}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
