"use client";

import { useState } from "react";
import {
  Activity,
  Ban,
  CalendarClock,
  ChevronDown,
  FilePlus2,
  Handshake,
  Inbox,
  Radar,
  Send,
  ShieldCheck,
  StickyNote,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { HistoryEvent, HistoryTone } from "@/lib/history/build";

/** Une ligne de l'historique : icône et couleur par type, extrait dépliable. */

const ICONS: Record<string, LucideIcon> = {
  sent: Send,
  received: Inbox,
  scheduled: CalendarClock,
  reminder: CalendarClock,
  "reminder-done": CalendarClock,
  "reminder-blocked": Ban,
  cancelled: XCircle,
  failed: XCircle,
  send_failed: XCircle,
  status: Activity,
  dnc: Ban,
  opposition: ShieldCheck,
  note: StickyNote,
  deal: Handshake,
  created: FilePlus2,
};

export const TONE_CLASS: Record<HistoryTone, string> = {
  brand: "bg-primary/10 text-primary-ink",
  good: "bg-good/10 text-good-ink",
  warn: "bg-warn/10 text-warn-ink",
  lost: "bg-lost/10 text-lost-ink",
  info: "bg-cyan/10 text-cyan-ink",
  neutral: "bg-surface-2 text-muted",
};

export function HistoryEventRow({ event }: { event: HistoryEvent }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[event.kind] ?? (event.channel === "signal" ? Radar : Activity);
  const expandable = Boolean(event.body && event.body !== event.excerpt);

  return (
    <li className="flex gap-3 py-2">
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TONE_CLASS[event.tone]}`} aria-hidden>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-text">{event.title}</span>
          {event.badge && <span className={`rounded-full px-2 py-0.5 text-[11px] ${TONE_CLASS[event.badge.tone]}`}>{event.badge.label}</span>}
          {event.upcoming && <span className="rounded-full border border-warn/25 px-2 py-0.5 text-[11px] text-warn-ink">à venir</span>}
        </div>
        {event.subject && <p className="truncate text-[13px] text-muted">{event.subject}</p>}
        {event.detail && <p className="text-[12px] text-faint">{event.detail}</p>}
        {open && event.body ? (
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{event.body}</p>
        ) : (
          event.excerpt && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{event.excerpt}</p>
        )}
        {expandable && (
          <button type="button" onClick={() => setOpen(!open)} className="mt-1 inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline" aria-expanded={open}>
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
            {open ? "Réduire" : "Texte complet"}
          </button>
        )}
      </div>
    </li>
  );
}
