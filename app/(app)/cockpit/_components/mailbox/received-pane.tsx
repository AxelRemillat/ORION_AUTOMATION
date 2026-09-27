"use client";

import { useState } from "react";
import Link from "next/link";
import { MailOpen, Sparkles } from "lucide-react";
import { MailTrashButton } from "@/components/outbox/mail-trash-button";
import { DoNotContactButton } from "@/components/outbox/do-not-contact-button";
import { formatParisDateTime } from "@/lib/outbox/paris-time";
import type { InboxEntry } from "../../_lib/types";
import { CategoryBadge } from "./category-badge";

/**
 * Onglet « Reçus » : la liste à gauche, la lecture à droite, avec les actions
 * — répondre (IA ou manuel, puis envoyer ou programmer), corbeille, « ne plus
 * contacter ».
 */
export function ReceivedPane({ entries }: { entries: InboxEntry[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;

  return (
    <div className="grid md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <ul className="scrollbar-thin max-h-[30rem] overflow-y-auto border-b border-line-soft md:border-b-0 md:border-r">
        {entries.map((entry) => {
          const active = selected?.id === entry.id;
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setSelectedId(entry.id)}
                aria-current={active ? "true" : undefined}
                className="w-full border-b border-l-2 border-b-line-soft px-4 py-3 text-left motion-safe:transition-colors"
                style={{
                  borderLeftColor: active ? "rgb(var(--rgb-warn))" : "transparent",
                  background: active ? "var(--warn-soft)" : "transparent",
                }}
              >
                <div className="flex items-center gap-2">
                  {entry.unread && (
                    <span aria-label="Non lu" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                  )}
                  <span className={`truncate text-[13px] ${entry.unread ? "font-semibold text-text" : "font-medium text-muted"}`}>
                    {entry.label}
                  </span>
                  <CategoryBadge category={entry.category} />
                </div>
                {entry.subject && <p className="mt-0.5 truncate text-[12px] font-medium text-muted">{entry.subject}</p>}
                <p className="mt-0.5 truncate text-[12px] text-faint">{entry.excerpt}</p>
                <p className="font-data mt-1 text-[11px] text-faint">{formatParisDateTime(entry.receivedAt)}</p>
              </button>
            </li>
          );
        })}
        {!entries.length && <li className="px-4 py-6 text-center text-[13px] text-faint">Aucun message</li>}
      </ul>

      <div className="min-h-[18rem] p-5">
        {selected ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold tracking-tight text-text">{selected.subject ?? "(sans objet)"}</h3>
                <p className="font-data mt-0.5 truncate text-[12px] text-muted">
                  {selected.label !== selected.fromEmail && `${selected.label} · `}
                  {selected.fromEmail}
                </p>
                <p className="font-data mt-0.5 text-[11px] text-faint">{formatParisDateTime(selected.receivedAt)}</p>
              </div>
              <CategoryBadge category={selected.category} />
            </div>

            <p className="scrollbar-thin mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
              {selected.body}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Link
                href={`/cockpit/inbox/${selected.id}`}
                className="inline-flex items-center gap-2 rounded-lg border border-warn/45 bg-warn/10 px-3 py-1.5 text-[13px] font-medium text-warn-ink motion-safe:transition-colors"
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Répondre
              </Link>
              {selected.prospectId && (
                <Link href={`/suivi/${selected.prospectId}`} className="text-[13px] text-muted hover:text-text">
                  Fiche prospect
                </Link>
              )}
              <span className="ml-auto flex flex-wrap items-center gap-2">
                {selected.prospectId && (
                  <DoNotContactButton
                    prospectId={selected.prospectId}
                    companyName={selected.label}
                    active={selected.doNotContact}
                  />
                )}
                <MailTrashButton
                  messageId={selected.id}
                  kind="received"
                  label={`le mail de ${selected.label}`}
                  onTrashed={() => setSelectedId(entries.find((entry) => entry.id !== selected.id)?.id ?? null)}
                />
              </span>
            </div>
          </>
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
