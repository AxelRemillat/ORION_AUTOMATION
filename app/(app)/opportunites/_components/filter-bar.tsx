import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { BUCKET_LABELS, type Bucket } from "@/lib/opportunities/view";
import type { Filter } from "@/lib/opportunities/tabs";

const chip = (active: boolean) =>
  cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px]", active ? "border-primary/30 bg-primary/10 text-primary-ink" : "border-line text-muted hover:bg-surface-2");

/** Filtres de l'onglet : par score, « À trier » (e-mails non reconnus), « Relances dues ». */
export function FilterBar({
  filters,
  counts,
  toSortCount,
  dueCount,
  active,
  onSelect,
}: {
  filters: (Bucket | "toutes")[];
  counts: Record<Bucket | "toutes", number>;
  toSortCount: number;
  dueCount: number;
  active: Filter;
  onSelect: (filter: Filter) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrer les opportunités">
      {filters.map((key) => (
        <button key={key} type="button" role="tab" aria-selected={active === key} onClick={() => onSelect(key)} className={chip(active === key)}>
          {BUCKET_LABELS[key]} <span className="font-data">{counts[key]}</span>
        </button>
      ))}
      <button type="button" role="tab" aria-selected={active === "a_trier"} onClick={() => onSelect("a_trier")} className={chip(active === "a_trier")}>
        <Inbox className="h-3.5 w-3.5" aria-hidden /> À trier <span className="font-data">{toSortCount}</span>
      </button>
      <button type="button" role="tab" aria-selected={active === "relances"} onClick={() => onSelect("relances")} className={chip(active === "relances")}>
        Relances dues <span className="font-data">{dueCount}</span>
      </button>
    </div>
  );
}
