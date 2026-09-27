import Link from "next/link";
import { cn } from "@/lib/utils";
import { MAILBOX_TABS, type MailboxCounts, type MailboxTab } from "@/lib/outbox/mailbox";

const countOf = (counts: MailboxCounts, tab: MailboxTab) =>
  tab === "recus" ? counts.recus : tab === "envoyes" ? counts.envoyes : counts.programmes;

/**
 * Onglets « Reçus · Envoyés · Programmés » avec leurs compteurs. Liens (page
 * plein écran, l'onglet vit dans l'URL) ou boutons (aperçu du Cockpit).
 */
export function MailboxTabBar({
  active,
  counts,
  hrefFor,
  onSelect,
}: {
  active: MailboxTab;
  counts: MailboxCounts;
  hrefFor?: (tab: MailboxTab) => string;
  onSelect?: (tab: MailboxTab) => void;
}) {
  return (
    <nav aria-label="Boîte mail" className="flex gap-1 overflow-x-auto px-3">
      {MAILBOX_TABS.map(({ key, label }) => {
        const isActive = key === active;
        const className = cn(
          "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
          isActive ? "border-primary text-text" : "border-transparent text-muted hover:text-text",
        );
        const content = (
          <>
            {label}
            <span className="font-data text-[12px] text-faint">{countOf(counts, key)}</span>
            {key === "recus" && counts.nonLus > 0 && (
              <span className="font-data rounded-full border border-warn/30 bg-warn/15 px-1.5 text-[11px] font-semibold text-warn-ink">
                {counts.nonLus} non lu{counts.nonLus > 1 ? "s" : ""}
              </span>
            )}
          </>
        );
        return hrefFor ? (
          <Link key={key} href={hrefFor(key)} aria-current={isActive ? "page" : undefined} className={className}>
            {content}
          </Link>
        ) : (
          <button key={key} type="button" onClick={() => onSelect?.(key)} aria-pressed={isActive} className={className}>
            {content}
          </button>
        );
      })}
    </nav>
  );
}
