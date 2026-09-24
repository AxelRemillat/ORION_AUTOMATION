import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Deal, InboundMessage, Message, Prospect, Reminder } from "@/types";
import { CockpitHeader } from "./_components/cockpit-header";
import { FocusCard } from "./_components/focus-card";
import { InboxCard } from "./_components/inbox-card";
import { KpiRow } from "./_components/kpi-row";
import { DueRemindersCard, RepliesCard } from "./_components/queues";
import { SignalsCard } from "./_components/signals-card";
import { EXAMPLE_FOCUS, EXAMPLE_SIGNALS } from "./_lib/example";
import {
  dueReminders,
  focusActions,
  pendingInbound,
  pendingReplies,
  topSignals,
  weeklyKpis,
} from "./_lib/compute";

export const metadata = { title: "Cockpit — ORION" };

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * COCKPIT — centre de commandement quotidien, écran d'accueil d'ORION.
 *
 * Tout ce qui est calculable l'est à partir des tables réelles (prospects,
 * messages, deals, reminders). Les deux zones sans back dédié — actions du jour
 * et signaux — sont DÉDUITES du pipeline existant, et ne basculent sur des
 * exemples étiquetés que si la base est encore vide.
 */
export default async function CockpitPage() {
  await requireUser();
  const supabase = createClient();

  const [prospectsResult, messagesResult, dealsResult, remindersResult, inboundResult] =
    await Promise.all([
      supabase.from("prospects").select("*"),
      supabase.from("messages").select("*"),
      supabase.from("deals").select("*"),
      supabase.from("reminders").select("*"),
      supabase.from("inbound_messages").select("*"),
    ]);

  const prospects = (prospectsResult.data ?? []) as Prospect[];
  const messages = (messagesResult.data ?? []) as Message[];
  const deals = (dealsResult.data ?? []) as Deal[];
  const reminders = (remindersResult.data ?? []) as Reminder[];
  const inbound = (inboundResult.data ?? []) as InboundMessage[];

  const focus = focusActions(prospects, messages, reminders);
  const signals = topSignals(prospects);
  const inboxItems = pendingInbound(inbound, prospects);

  const date = DATE_FORMAT.format(new Date());
  const subtitle = inboxItems.length
    ? `${inboxItems.length} réponse${inboxItems.length > 1 ? "s" : ""} à traiter. Commencez par là.`
    : prospects.length
    ? `${prospects.length} prospect${prospects.length > 1 ? "s" : ""} en portefeuille. Voici par quoi commencer.`
    : "Votre portefeuille est vide : l'écran se remplira dès vos premiers prospects.";

  return (
    <div className="flex flex-col gap-6">
      <CockpitHeader
        title="Cockpit"
        subtitle={subtitle}
        date={date.charAt(0).toUpperCase() + date.slice(1)}
      />

      {/* En premier, avant même les actions du jour : quelqu'un attend. */}
      <InboxCard items={inboxItems} />

      <FocusCard
        actions={focus.length ? focus : EXAMPLE_FOCUS}
        isExample={focus.length === 0}
      />

      <KpiRow kpis={weeklyKpis(prospects, messages, deals)} />

      <div className="grid gap-4 lg:grid-cols-2">
        <DueRemindersCard reminders={dueReminders(reminders, prospects)} />
        <RepliesCard replies={pendingReplies(prospects)} />
      </div>

      <SignalsCard
        signals={signals.length ? signals : EXAMPLE_SIGNALS}
        isExample={signals.length === 0}
      />
    </div>
  );
}
