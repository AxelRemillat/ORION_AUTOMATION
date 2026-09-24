import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  ActionState,
  Deal,
  InboundMessage,
  Message,
  Prospect,
  Reminder,
} from "@/types";
import { CockpitHeader } from "./_components/cockpit-header";
import { ActionQueue } from "./_components/action-queue";
import { InboxPanel } from "./_components/inbox-panel";
import { KpiChart } from "./_components/kpi-chart";
import { SignalsCard } from "./_components/signals-card";
import { EXAMPLE_SIGNALS } from "./_lib/example";
import { buildQueue } from "./_lib/queue";
import { buildAllPeriods } from "./_lib/series";
import { inboxEntries, topSignals } from "./_lib/compute";

export const metadata = { title: "Cockpit — ORION" };

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * COCKPIT — centre de commandement quotidien, écran d'accueil d'ORION.
 *
 * Quatre blocs, dans l'ordre où on les traite : ce qu'il faut FAIRE, ce qui est
 * ARRIVÉ, ce qui a été CAPTÉ, puis la tendance. Chacun a son registre visuel —
 * rouge, ambre, violet/cyan, neutre — pour qu'un coup d'œil suffise à savoir
 * de quoi on lui parle.
 *
 * Les chiffres détaillés vivent sur /stats : le Cockpit n'en garde qu'une
 * courbe. Tout vient des tables réelles ; rien n'est inventé.
 */
export default async function CockpitPage() {
  await requireUser();
  const supabase = createClient();

  const [
    prospectsResult,
    messagesResult,
    dealsResult,
    remindersResult,
    inboundResult,
    statesResult,
  ] = await Promise.all([
    supabase.from("prospects").select("*"),
    supabase.from("messages").select("*"),
    supabase.from("deals").select("*"),
    supabase.from("reminders").select("*"),
    supabase.from("inbound_messages").select("*"),
    supabase.from("action_states").select("*"),
  ]);

  const prospects = (prospectsResult.data ?? []) as Prospect[];
  const messages = (messagesResult.data ?? []) as Message[];
  const deals = (dealsResult.data ?? []) as Deal[];
  const reminders = (remindersResult.data ?? []) as Reminder[];
  const inbound = (inboundResult.data ?? []) as InboundMessage[];
  const states = (statesResult.data ?? []) as ActionState[];

  const signals = topSignals(prospects);
  const mailbox = inboxEntries(inbound, prospects);
  const unread = mailbox.filter((entry) => entry.unread).length;

  // Une seule file, triee par urgence : on n'en montre que la tete. Les
  // relances dues y remontent deja, d'ou le retrait de leur ancien bloc.
  const queue = buildQueue({
    prospects,
    messages,
    reminders,
    inbound: inbound
      .filter((message) => !message.handled)
      .map((message) => ({ id: message.id, prospect_id: message.prospect_id })),
    states,
  });

  const date = DATE_FORMAT.format(new Date());
  const subtitle = unread
    ? `${unread} réponse${unread > 1 ? "s" : ""} à traiter. Commencez par là.`
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

      <ActionQueue visible={queue.visible} total={queue.total} />

      <InboxPanel entries={mailbox} />

      <SignalsCard
        signals={signals.length ? signals : EXAMPLE_SIGNALS}
        isExample={signals.length === 0}
      />

      <KpiChart periods={buildAllPeriods({ messages, inbound, prospects, deals })} />
    </div>
  );
}
