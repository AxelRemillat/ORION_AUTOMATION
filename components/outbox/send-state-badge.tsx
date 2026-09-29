import { AlertTriangle, CalendarClock, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatScheduled } from "@/lib/outbox/paris-time";
import type { SendStatus } from "@/types";

/**
 * État d'envoi d'un mail : « Programmé · lun. 9h00 », « Envoi en cours »,
 * « Échec d'envoi ». Rien pour un brouillon ordinaire ou un mail parti.
 */
export function SendStateBadge({
  sendStatus,
  scheduledAt,
  sendError,
  className,
}: {
  sendStatus?: SendStatus | null;
  scheduledAt?: string | null;
  sendError?: string | null;
  className?: string;
}) {
  if (sendStatus === "scheduled" && scheduledAt) {
    return (
      <Badge tone="accent" className={className} title={sendError ?? undefined}>
        <CalendarClock className="h-3 w-3" aria-hidden />
        Programmé · {formatScheduled(scheduledAt)}
      </Badge>
    );
  }
  if (sendStatus === "sending") {
    return (
      <Badge tone="info" className={className}>
        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
        Envoi en cours
      </Badge>
    );
  }
  if (sendStatus === "blocked") {
    return (
      <Badge tone="danger" className={className} title={sendError ?? undefined}>
        <ShieldAlert className="h-3 w-3" aria-hidden />
        Bloqué avant envoi
      </Badge>
    );
  }
  if (sendStatus === "failed") {
    return (
      <Badge tone="danger" className={className} title={sendError ?? undefined}>
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Échec d&apos;envoi
      </Badge>
    );
  }
  return null;
}
