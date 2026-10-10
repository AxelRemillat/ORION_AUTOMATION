import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/opportunities/types";

/** Lien « Ouvrir l'annonce » : l'ouvrir marque l'alerte comme vue. */
export function OpenAdLink({ item, onOpen }: { item: Opportunity; onOpen: (item: Opportunity) => void }) {
  return (
    <a
      href={item.url ?? "#"}
      target="_blank"
      rel="noreferrer"
      onClick={() => onOpen(item)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-text hover:bg-surface-2",
        !item.url && "pointer-events-none opacity-50",
      )}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Ouvrir l&apos;annonce
    </a>
  );
}
