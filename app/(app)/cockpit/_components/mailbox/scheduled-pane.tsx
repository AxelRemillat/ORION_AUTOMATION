import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { MailActions } from "@/components/outbox/mail-actions";
import type { ScheduledItem } from "@/lib/outbox/mailbox";
import { MESSAGE_TYPE_LABELS } from "@/lib/constants";
import { ScheduledText } from "./scheduled-editor";

/** Onglet « Programmés » : heure prévue, modifier l'heure, annuler, corbeille. */
export function ScheduledPane({ items }: { items: ScheduledItem[] }) {
  if (!items.length) {
    return (
      <div className="flex min-h-[14rem] flex-col items-center justify-center p-6 text-center">
        <CalendarClock className="mb-3 h-7 w-7 text-faint" aria-hidden />
        <p className="text-sm font-semibold text-text">Aucun envoi programmé</p>
        <p className="mt-1 max-w-xs text-[13px] text-muted">
          Programmez un brouillon ou une réponse : il partira seul, à l&apos;heure dite.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line-soft">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-[200px] flex-1">
            <Link href={`/suivi/${item.prospectId}`} className="text-[13px] font-medium text-text hover:text-primary">
              {item.companyName}
            </Link>
            <p className="truncate text-[12px] text-faint">
              {MESSAGE_TYPE_LABELS[item.type]} · {item.subject || "(sans objet)"}
              {item.to ? ` · à ${item.to}` : ""}
            </p>
          </div>
          <MailActions
            state={{
              messageId: item.id,
              sendStatus: item.sendStatus,
              scheduledAt: item.scheduledAt,
              scheduledTo: item.to,
              sendError: item.sendError,
            }}
            defaultTo={item.to ?? ""}
            label={`le mail pour ${item.companyName}`}
          />
          {/* Le texte se relit — et se corrige — avant le départ. */}
          <ScheduledText item={item} />
        </li>
      ))}
    </ul>
  );
}
