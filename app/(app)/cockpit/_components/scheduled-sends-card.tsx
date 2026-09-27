import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { MailActions } from "@/components/outbox/mail-actions";
import type { OutboxItem } from "@/lib/outbox/feed";

/**
 * Envois programmés : ce qui partira seul, et les échecs à reprendre. Chaque
 * ligne se modifie ou s'annule sur place. Absent quand il n'y a rien.
 */
export function ScheduledSendsCard({ items }: { items: OutboxItem[] }) {
  if (!items.length) return null;
  return (
    <Card id="envois-programmes" className="scroll-mt-20">
      <CardHeader className="flex-row items-center gap-2">
        <CalendarClock className="h-4 w-4 text-primary" aria-hidden />
        <CardTitle>Envois programmés</CardTitle>
        <span className="font-data ml-auto text-[12px] text-faint">{items.length}</span>
      </CardHeader>
      <CardContent className="divide-y divide-line-soft p-0">
        {items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-[200px] flex-1">
              <Link href={`/suivi/${item.prospectId}`} className="text-[13px] font-medium text-text hover:text-primary">
                {item.companyName}
              </Link>
              <p className="truncate text-[12px] text-faint">
                {item.subject || "(sans objet)"}
                {item.scheduledTo ? ` · à ${item.scheduledTo}` : ""}
              </p>
            </div>
            <MailActions
              state={{
                messageId: item.id,
                sendStatus: item.sendStatus,
                scheduledAt: item.scheduledAt,
                scheduledTo: item.scheduledTo,
                sendError: item.sendError,
              }}
              defaultTo={item.scheduledTo ?? ""}
              label={`le mail pour ${item.companyName}`}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
