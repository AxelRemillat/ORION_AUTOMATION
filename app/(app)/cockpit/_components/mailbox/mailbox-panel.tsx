"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";
import type { MailboxCounts, MailboxTab, ScheduledItem, SentItem, ThreadItem } from "@/lib/outbox/mailbox";
import type { InboxEntry } from "../../_lib/types";
import { MailboxTabBar } from "./tab-bar";
import { ReceivedPane } from "./received-pane";
import { SentPane } from "./sent-pane";
import { ScheduledPane } from "./scheduled-pane";
import { InboxReadProvider } from "./read-state";

/**
 * Boîte mail du Cockpit — un APERÇU des trois onglets (les plus récents) ;
 * « Tout voir » ouvre la page plein écran /cockpit/mails, avec recherche et
 * pagination. Registre chaud ambre : quelqu'un attend peut-être une réponse.
 */
export function MailboxPanel({
  received,
  sent,
  scheduled,
  threads,
  counts,
}: {
  received: InboxEntry[];
  sent: SentItem[];
  scheduled: ScheduledItem[];
  threads: Record<string, ThreadItem[]>;
  counts: MailboxCounts;
}) {
  const [tab, setTab] = useState<MailboxTab>("recus");

  return (
    /* « Lu / non lu » optimiste : le compteur de l'onglet suit les clics. */
    <InboxReadProvider entries={received} initialUnread={counts.nonLus}>
      <section className="shadow-mist relative overflow-hidden rounded-xl border border-warn/45 bg-surface">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1"
          style={{ background: "linear-gradient(90deg, rgb(var(--rgb-warn)), rgb(var(--rgb-lost)))" }}
        />
        <div className="flex items-center gap-2 px-5 pb-2 pt-5">
          <Inbox className="h-4 w-4 text-warn-ink" aria-hidden />
          <h2 className="text-[15px] font-semibold tracking-tight text-text">Boîte mail</h2>
          <Link
            href={`/cockpit/mails?onglet=${tab}`}
            className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-text"
          >
            Tout voir
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <div className="border-b border-warn/20">
          <MailboxTabBar active={tab} counts={counts} onSelect={setTab} />
        </div>
        {tab === "recus" && <ReceivedPane entries={received} />}
        {tab === "envoyes" && <SentPane items={sent} threads={threads} />}
        {tab === "programmes" && <ScheduledPane items={scheduled} />}
      </section>
    </InboxReadProvider>
  );
}
