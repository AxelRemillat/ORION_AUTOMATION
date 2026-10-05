"use client";

import { useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatParisDateTime } from "@/lib/outbox/paris-time";
import { readableSendError } from "@/lib/outbox/send-errors";
import { ResendControls } from "@/components/outbox/resend-controls";
import type { SentItem, ThreadItem } from "@/lib/outbox/mailbox";
import { ThreadView } from "../../inbox/[id]/thread-view";

/**
 * Onglet « Envoyés » : la liste à gauche ; à droite, le mail en entier puis
 * tout le fil de la conversation, envoyés et reçus mêlés dans l'ordre.
 */
export function SentPane({
  items,
  threads,
  initialId,
}: {
  items: SentItem[];
  /** Fil par prospect, pour les mails de la liste. */
  threads: Record<string, ThreadItem[]>;
  initialId?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? items[0]?.id ?? null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  if (!items.length) {
    return (
      <div className="flex min-h-[14rem] flex-col items-center justify-center p-6 text-center">
        <Send className="mb-3 h-7 w-7 text-faint" aria-hidden />
        <p className="text-sm font-semibold text-text">Aucun mail envoyé</p>
        <p className="mt-1 max-w-xs text-[13px] text-muted">Intros, relances et réponses parties apparaîtront ici.</p>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <ul className="scrollbar-thin max-h-[30rem] overflow-y-auto border-b border-line-soft md:border-b-0 md:border-r">
        {items.map((item) => {
          const active = selected?.id === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                aria-current={active ? "true" : undefined}
                className={`w-full border-b border-l-2 border-b-line-soft px-4 py-3 text-left motion-safe:transition-colors ${
                  active ? "border-l-primary bg-primary/10" : "border-l-transparent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-text">{item.companyName}</span>
                  <Badge tone="neutral">{item.typeLabel}</Badge>
                  {item.status === "failed" && <Badge tone="danger">Échec</Badge>}
                </div>
                <p className="mt-0.5 truncate text-[12px] font-medium text-muted">{item.subject ?? "(sans objet)"}</p>
                <p className="mt-0.5 truncate text-[12px] text-faint">{item.excerpt}</p>
                <p className="font-data mt-1 truncate text-[11px] text-faint">
                  {formatParisDateTime(item.at)}
                  {item.to ? ` · ${item.to}` : ""}
                </p>
              </button>
              {item.status === "failed" && (
                <div className="border-b border-b-line-soft px-4 pb-3">
                  <ResendControls messageId={item.id} to={item.to} compact />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="min-h-[18rem] p-5">
        {selected && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold tracking-tight text-text">{selected.subject ?? "(sans objet)"}</h3>
                <p className="font-data mt-0.5 text-[12px] text-muted">
                  {selected.companyName} · {selected.to ?? "destinataire non enregistré"}
                </p>
                <p className="font-data mt-0.5 text-[11px] text-faint">
                  {selected.status === "sent" ? "Envoyé" : "Dernière tentative"} {formatParisDateTime(selected.at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{selected.typeLabel}</Badge>
                <Badge tone={selected.status === "sent" ? "success" : "danger"}>
                  {selected.status === "sent" ? "Envoyé" : "Échec"}
                </Badge>
              </div>
            </div>
            {selected.error && (
              <p className="mt-2 text-[12px] text-lost-ink" title={selected.error}>
                {readableSendError(selected.error)}
              </p>
            )}
            {selected.status === "failed" && (
              <div className="mt-3">
                <ResendControls messageId={selected.id} to={selected.to} />
              </div>
            )}
            <p className="mt-4 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{selected.body}</p>
            <Link href={`/suivi/${selected.prospectId}`} className="mt-4 inline-block text-[13px] font-medium text-primary-ink hover:underline">
              Ouvrir la fiche prospect
            </Link>

            <h4 className="mb-3 mt-6 text-[13px] font-semibold text-text">Fil de la conversation</h4>
            <ThreadView
              entries={(threads[selected.prospectId] ?? []).map((entry) => ({
                ...entry,
                answering: entry.id === selected.id,
              }))}
            />
          </>
        )}
      </div>
    </div>
  );
}
