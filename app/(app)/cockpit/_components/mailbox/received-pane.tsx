"use client";

import { useState } from "react";
import { MailOpen } from "lucide-react";
import { formatParisDateTime } from "@/lib/outbox/paris-time";
import type { InboxEntry } from "../../_lib/types";
import { CategoryBadge } from "./category-badge";
import { ReadToggle } from "./read-toggle";
import { ReceivedReader } from "./received-reader";
import { useInboxRead } from "./read-state";

/**
 * Onglet « Reçus » : la liste à gauche, la lecture à droite, avec les actions
 * — répondre (IA ou manuel, puis envoyer ou programmer), lu / non lu,
 * corbeille, « ne plus contacter ».
 */
export function ReceivedPane({ entries }: { entries: InboxEntry[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;
  const read = useInboxRead();

  return (
    <div className="grid md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <ul className="scrollbar-thin max-h-[30rem] overflow-y-auto border-b border-line-soft md:border-b-0 md:border-r">
        {entries.map((entry) => {
          const active = selected?.id === entry.id;
          const unread = read?.isUnread(entry.id, entry.unread) ?? entry.unread;
          return (
            <li
              key={entry.id}
              className="flex items-start gap-1 border-b border-l-2 border-b-line-soft pr-2 motion-safe:transition-colors"
              style={{
                borderLeftColor: active ? "rgb(var(--rgb-warn))" : "transparent",
                background: active ? "var(--warn-soft)" : "transparent",
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedId(entry.id)}
                aria-current={active ? "true" : undefined}
                className="min-w-0 flex-1 px-4 py-3 text-left"
              >
                <div className="flex items-center gap-2">
                  {unread && <span aria-label="Non lu" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
                  <span className={`truncate text-[13px] ${unread ? "font-semibold text-text" : "font-medium text-muted"}`}>
                    {entry.label}
                  </span>
                  <CategoryBadge category={entry.category} auto={entry.autoKind} />
                </div>
                {entry.subject && <p className="mt-0.5 truncate text-[12px] font-medium text-muted">{entry.subject}</p>}
                <p className="mt-0.5 truncate text-[12px] text-faint">{entry.excerpt}</p>
                <p className="font-data mt-1 text-[11px] text-faint">{formatParisDateTime(entry.receivedAt)}</p>
              </button>
              <ReadToggle id={entry.id} unread={entry.unread} className="mt-3" />
            </li>
          );
        })}
        {!entries.length && <li className="px-4 py-6 text-center text-[13px] text-faint">Aucun message</li>}
      </ul>

      <div className="min-h-[18rem] p-5">
        {selected ? (
          <ReceivedReader
            key={selected.id}
            entry={selected}
            onTrashed={() => setSelectedId(entries.find((entry) => entry.id !== selected.id)?.id ?? null)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MailOpen className="mb-3 h-8 w-8 text-faint" aria-hidden />
            <p className="text-sm font-semibold text-text">Boîte vide</p>
            <p className="mt-1 max-w-xs text-[13px] text-muted">Les réponses de tes prospects arriveront ici.</p>
          </div>
        )}
      </div>
    </div>
  );
}
