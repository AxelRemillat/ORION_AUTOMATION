import { AlarmClock, Check, FileSignature, MailCheck, PenLine } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import type { EventKind, TimelineEvent } from "../_lib/timeline";
import { MailActions } from "@/components/outbox/mail-actions";
import { SendMessageDialog } from "./send-message-dialog";

const ICONS: Record<EventKind, typeof MailCheck> = {
  sent: MailCheck,
  draft: PenLine,
  reminder: AlarmClock,
  "reminder-done": Check,
  deal: FileSignature,
};

const TONE_TOKEN: Record<TimelineEvent["tone"], string> = {
  brand: "var(--primary)",
  warn: "var(--warn)",
  good: "var(--good)",
  neutral: "var(--faint)",
};

/**
 * Fil chronologique de l'affaire : rail dégradé à gauche, un jalon par
 * événement. Les brouillons portent leur bouton d'envoi, et leurs actions :
 * programmer, annuler la programmation, corbeille.
 */
export function DealTimeline({
  events,
  prospectId,
  defaultTo,
}: {
  events: TimelineEvent[];
  prospectId: string;
  defaultTo: string;
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="Rien à afficher pour l'instant"
        description="Préparez l'email d'approche depuis la Prospection : messages, relances et signature viendront s'empiler ici."
      />
    );
  }

  return (
    <ol className="relative space-y-3 pl-6">
      {/* Rail : la ligne de temps, peinte au dégradé de marque. */}
      <span
        className="pointer-events-none absolute bottom-2 left-[7px] top-2 w-px rounded-full opacity-40"
        style={{ backgroundImage: "var(--accent-grad)" }}
        aria-hidden
      />

      {events.map((event) => {
        const Icon = ICONS[event.kind];
        const color = TONE_TOKEN[event.tone];
        return (
          <li key={event.id} className="relative">
            <span
              className="absolute -left-6 top-3 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface"
              aria-hidden
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            </span>

            <div className="rounded-lg border border-line bg-surface p-4 shadow-mist">
              <div className="flex flex-wrap items-center gap-2">
                <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden />
                <span className="text-[13px] font-medium text-text">{event.title}</span>
                <span className="font-data text-[11px] text-faint">{formatDateTime(event.at)}</span>

                {event.kind === "draft" && event.messageId && event.sendStatus !== "sending" && (
                  <div className="ml-auto">
                    <SendMessageDialog
                      prospectId={prospectId}
                      messageId={event.messageId}
                      subject={event.subject ?? null}
                      body={event.body ?? ""}
                      defaultTo={event.scheduledTo ?? defaultTo}
                    />
                  </div>
                )}
              </div>

              {event.kind === "draft" && event.messageId && (
                <div className="mt-2.5">
                  <MailActions
                    state={{
                      messageId: event.messageId,
                      sendStatus: event.sendStatus,
                      scheduledAt: event.scheduledAt,
                      scheduledTo: event.scheduledTo,
                      sendError: event.sendError,
                    }}
                    defaultTo={defaultTo}
                    label="ce brouillon"
                  />
                </div>
              )}

              {event.subject && (
                <p className="mt-2.5 text-sm font-medium text-text">{event.subject}</p>
              )}
              {event.body && (
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                  {event.body}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
