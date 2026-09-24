"use client";

import { useState } from "react";
import Link from "next/link";
import { Inbox, MailOpen, Sparkles } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { InboundCategory } from "@/types";
import type { InboxEntry } from "../_lib/types";

/**
 * Boîte de réception — messagerie simplifiée, toujours affichée.
 *
 * Deux panneaux : la liste à gauche, la lecture à droite. Le cadre reste en
 * place même vide, pour que la place de cette fonction dans l'écran soit
 * stable : on sait où regarder, qu'il y ait du courrier ou non.
 *
 * Registre chaud ambre → corail, comme précédemment : tout le reste de l'app
 * aide à décider, ce bloc signale que quelqu'un attend.
 */

const CATEGORY_STYLE: Record<InboundCategory, { label: string; className: string }> = {
  reponse: { label: "Réponse", className: "border-good/30 bg-good/10 text-good-ink" },
  question: { label: "Question", className: "border-primary/30 bg-primary/10 text-primary-ink" },
  relance: { label: "Relance", className: "border-warn/30 bg-warn/10 text-warn-ink" },
  refus: { label: "Refus", className: "border-lost/30 bg-lost/10 text-lost-ink" },
  autre: { label: "À lire", className: "border-line bg-surface-2 text-muted" },
};

function CategoryBadge({ category }: { category: InboundCategory }) {
  const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.autre;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function InboxPanel({ entries }: { entries: InboxEntry[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.id ?? null);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;
  const unread = entries.filter((entry) => entry.unread).length;

  return (
    <section
      className="shadow-mist relative overflow-hidden rounded-xl border"
      style={{ borderColor: "rgb(var(--rgb-warn) / 0.45)", background: "var(--surface)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{ background: "linear-gradient(90deg, rgb(var(--rgb-warn)), rgb(var(--rgb-lost)))" }}
      />

      <div className="flex items-center gap-2 px-5 pb-3 pt-5">
        <Inbox className="h-4 w-4 text-warn-ink" aria-hidden />
        <h2 className="text-[15px] font-semibold tracking-tight text-text">Boîte de réception</h2>
        {unread > 0 && (
          <span className="font-data rounded-full border border-warn/30 bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn-ink">
            {unread} non lu{unread > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="grid border-t md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]" style={{ borderColor: "rgb(var(--rgb-warn) / 0.22)" }}>
        {/* Colonne gauche — la liste */}
        <ul
          className="scrollbar-thin max-h-[26rem] overflow-y-auto border-b md:border-b-0 md:border-r"
          style={{ borderColor: "rgb(var(--rgb-warn) / 0.22)" }}
        >
          {entries.map((entry) => {
            const active = selected?.id === entry.id;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(entry.id)}
                  aria-current={active ? "true" : undefined}
                  className="w-full border-b border-l-2 px-4 py-3 text-left motion-safe:transition-colors"
                  style={{
                    borderBottomColor: "rgb(var(--rgb-warn) / 0.16)",
                    borderLeftColor: active ? "rgb(var(--rgb-warn))" : "transparent",
                    background: active ? "var(--warn-soft)" : "transparent",
                  }}
                >
                  <div className="flex items-center gap-2">
                    {entry.unread && (
                      <span
                        aria-label="Non lu"
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: "rgb(var(--rgb-warn))" }}
                      />
                    )}
                    <span
                      className={`truncate text-[13px] ${entry.unread ? "font-semibold text-text" : "font-medium text-muted"}`}
                    >
                      {entry.label}
                    </span>
                    <CategoryBadge category={entry.category} />
                  </div>
                  {entry.subject && (
                    <p className="mt-0.5 truncate text-[12px] font-medium text-muted">
                      {entry.subject}
                    </p>
                  )}
                  <p className="mt-0.5 truncate text-[12px] text-faint">{entry.excerpt}</p>
                  <p className="font-data mt-1 text-[11px] text-faint">
                    {formatDateTime(entry.receivedAt)}
                  </p>
                </button>
              </li>
            );
          })}

          {!entries.length && (
            <li className="px-4 py-6 text-center text-[13px] text-faint">Aucun message</li>
          )}
        </ul>

        {/* Colonne droite — la lecture */}
        <div className="min-h-[18rem] p-5">
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold tracking-tight text-text">
                    {selected.subject ?? "(sans objet)"}
                  </h3>
                  <p className="font-data mt-0.5 truncate text-[12px] text-muted">
                    {selected.label !== selected.fromEmail && `${selected.label} · `}
                    {selected.fromEmail}
                  </p>
                  <p className="font-data mt-0.5 text-[11px] text-faint">
                    {formatDateTime(selected.receivedAt)}
                  </p>
                </div>
                <CategoryBadge category={selected.category} />
              </div>

              <p className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-muted scrollbar-thin">
                {selected.body}
              </p>

              <Link
                href={`/cockpit/inbox/${selected.id}`}
                className="mt-5 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium motion-safe:transition-colors"
                style={{
                  borderColor: "rgb(var(--rgb-warn) / 0.45)",
                  background: "var(--warn-soft)",
                  color: "var(--warn-ink)",
                }}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Répondre avec l&apos;IA
              </Link>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <MailOpen className="mb-3 h-8 w-8 text-faint" aria-hidden />
              <p className="text-sm font-semibold text-text">Boîte vide</p>
              <p className="mt-1 max-w-xs text-[13px] text-muted">
                Les réponses de tes prospects arriveront ici.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
