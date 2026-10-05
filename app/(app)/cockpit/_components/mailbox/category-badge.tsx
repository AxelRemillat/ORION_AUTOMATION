import type { InboundCategory } from "@/types";
import { AUTO_REPLY_LABEL, type AutoReplyKind } from "@/lib/inbound/auto-reply";

/** Nature d'un mail reçu, triée par n8n : registre chaud de la boîte de réception. */
const CATEGORY_STYLE: Record<InboundCategory, { label: string; className: string }> = {
  reponse: { label: "Réponse", className: "border-good/30 bg-good/10 text-good-ink" },
  question: { label: "Question", className: "border-primary/30 bg-primary/10 text-primary-ink" },
  relance: { label: "Relance", className: "border-warn/30 bg-warn/10 text-warn-ink" },
  refus: { label: "Refus", className: "border-lost/30 bg-lost/10 text-lost-ink" },
  autre: { label: "À lire", className: "border-line bg-surface-2 text-muted" },
};

/** Réponses automatiques : la nature réelle prime sur le tri de n8n. */
const AUTO_STYLE: Record<AutoReplyKind, string> = {
  antispam: "border-warn/45 bg-warn/15 text-warn-ink",
  absence: "border-line bg-surface-2 text-muted",
};

export function CategoryBadge({ category, auto = null }: { category: InboundCategory; auto?: AutoReplyKind | null }) {
  const style = auto ? { label: AUTO_REPLY_LABEL[auto], className: AUTO_STYLE[auto] } : CATEGORY_STYLE[category] ?? CATEGORY_STYLE.autre;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${style.className}`}
    >
      {style.label}
    </span>
  );
}
