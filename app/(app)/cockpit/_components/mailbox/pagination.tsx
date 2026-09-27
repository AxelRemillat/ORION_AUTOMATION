import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Pagination par liens : la page vit dans l'URL, le retour arrière fonctionne. */
export function Pagination({
  page,
  pages,
  total,
  hrefFor,
}: {
  page: number;
  pages: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const step = (target: number, label: string, Icon: typeof ChevronLeft, disabled: boolean) =>
    disabled ? (
      <span className={cn(base, "opacity-40")} aria-disabled>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </span>
    ) : (
      <Link href={hrefFor(target)} className={cn(base, "hover:bg-surface-2 hover:text-text")}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </Link>
    );

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line-soft px-5 py-3">
      {step(page - 1, "Précédent", ChevronLeft, page <= 1)}
      <span className="font-data text-[12px] text-faint">
        Page {page} / {pages} · {total} mail{total > 1 ? "s" : ""}
      </span>
      {step(page + 1, "Suivant", ChevronRight, page >= pages)}
    </nav>
  );
}

const base = "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted";
