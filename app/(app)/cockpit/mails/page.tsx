import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { Card, Input, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPortfolio } from "@/lib/trash/portfolio";
import { matches, paginate, parseTab, type MailboxTab } from "@/lib/outbox/mailbox";
import { MailboxTabBar } from "../_components/mailbox/tab-bar";
import { ReceivedPane } from "../_components/mailbox/received-pane";
import { SentPane } from "../_components/mailbox/sent-pane";
import { ScheduledPane } from "../_components/mailbox/scheduled-pane";
import { Pagination } from "../_components/mailbox/pagination";
import { buildMailbox, threadsFor } from "../_lib/mailbox-data";

export const metadata = { title: "Boîte mail — ORION" };
export const dynamic = "force-dynamic";

type Params = { onglet?: string; q?: string; page?: string; id?: string };

/**
 * Boîte mail plein écran : mêmes onglets que le Cockpit, pour lire
 * confortablement. Onglet, recherche et page vivent dans l'URL.
 */
export default async function MailboxPage({ searchParams }: { searchParams: Params }) {
  await requireUser();
  const tab = parseTab(searchParams.onglet);
  const query = (searchParams.q ?? "").trim();
  const page = Number(searchParams.page ?? "1");

  const { prospects, messages, inbound } = await loadPortfolio(createClient(), ["messages", "inbound"]);
  const mailbox = buildMailbox({ prospects, messages, inbound });

  const href = (next: { onglet?: MailboxTab; page?: number }) => {
    const params = new URLSearchParams();
    params.set("onglet", next.onglet ?? tab);
    if (query) params.set("q", query);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    return `/cockpit/mails?${params.toString()}`;
  };

  const received = paginate(
    mailbox.received.filter((entry) => matches(query, entry.label, entry.subject, entry.fromEmail)),
    page,
  );
  const sent = paginate(
    mailbox.sent.filter((item) => matches(query, item.companyName, item.subject, item.to)),
    page,
  );
  const scheduled = mailbox.scheduled.filter((item) => matches(query, item.companyName, item.subject, item.to));
  const pagination = tab === "recus" ? received : tab === "envoyes" ? sent : null;

  return (
    <>
      <Link href="/cockpit" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Retour au Cockpit
      </Link>
      <PageHeader title="Boîte mail" description="Reçus, envoyés et programmés, avec le fil complet de chaque conversation." />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-soft pr-4">
          <MailboxTabBar active={tab} counts={mailbox.counts} hrefFor={(key) => `/cockpit/mails?onglet=${key}`} />
          <form action="/cockpit/mails" className="relative mb-2 w-full sm:w-72">
            <input type="hidden" name="onglet" value={tab} />
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
            <Input
              name="q"
              defaultValue={query}
              placeholder="Entreprise ou objet…"
              aria-label="Rechercher par entreprise ou objet"
              className="pl-9"
            />
          </form>
        </div>

        {tab === "recus" && <ReceivedPane key={`${query}-${received.page}`} entries={received.items} />}
        {tab === "envoyes" && (
          <SentPane
            key={`${query}-${sent.page}`}
            items={sent.items}
            threads={threadsFor(sent.items, messages, inbound)}
            initialId={searchParams.id}
          />
        )}
        {tab === "programmes" && <ScheduledPane items={scheduled} />}

        {pagination && pagination.pages > 1 && (
          <Pagination page={pagination.page} pages={pagination.pages} total={pagination.total} hrefFor={(next) => href({ page: next })} />
        )}
      </Card>
    </>
  );
}
