import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPortfolio } from "@/lib/trash/portfolio";
import type { ActionState } from "@/types";
import { CockpitHeader } from "./_components/cockpit-header";
import { ActionQueueCard } from "./_components/versus/action-queue-card";
import { MailboxPanel } from "./_components/mailbox/mailbox-panel";
import { buildMailbox, threadsFor } from "./_lib/mailbox-data";
import { ActivityCard } from "./_components/activity/activity-card";
import { SignalsCard } from "./_components/signals-card";
import { EXAMPLE_SIGNALS } from "./_lib/example";
import { buildQueue } from "./_lib/queue";
import { buildAllPeriods, parseSeriesParam } from "./_lib/series";
import { topSignals } from "./_lib/compute";
import { PilotageCard } from "./_components/pilotage/pilotage-card";
import { loadPilotage } from "@/lib/usage/pilotage";

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
export default async function CockpitPage({
  searchParams,
}: {
  // La selection de series vit dans l'URL : lue ici pour eviter un
  // clignotement entre le rendu serveur et la reprise cote client.
  searchParams: { kpi?: string };
}) {
  await requireUser();
  const supabase = createClient();

  // Corbeille exclue partout : file d'actions, boîte de réception, courbes.
  const [{ prospects, messages, deals, reminders, inbound }, statesResult, pilotage] = await Promise.all([
    loadPortfolio(supabase, ["messages", "deals", "reminders", "inbound"]),
    supabase.from("action_states").select("*"),
    // Pilotage : agrégats serveur, soldes fournisseurs en cache 1 h. Une panne
    // ici ne doit jamais empêcher le Cockpit de s'afficher.
    loadPilotage(supabase).catch(() => null),
  ]);
  const states = (statesResult.data ?? []) as ActionState[];

  const signals = topSignals(prospects);
  // Aperçu de la boîte mail : les plus récents ; « Tout voir » → /cockpit/mails.
  const mailbox = buildMailbox({ prospects, messages, inbound });
  const recentSent = mailbox.sent.slice(0, 10);
  const unread = mailbox.counts.nonLus;
  // Une réponse déjà programmée n'est plus une action à faire.
  const answered = new Set(
    messages
      .filter((message) => message.reply_to_inbound_id && message.send_status === "scheduled")
      .map((message) => message.reply_to_inbound_id as string),
  );

  // Une seule file, triee par urgence : on n'en montre que la tete. Les
  // relances dues y remontent deja, d'ou le retrait de leur ancien bloc.
  const queue = buildQueue({
    prospects,
    messages,
    reminders,
    inbound: inbound
      .filter((message) => !message.handled && !answered.has(message.id))
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

      <ActionQueueCard visible={queue.visible} total={queue.total} />

      <MailboxPanel
        received={mailbox.received.slice(0, 30)}
        sent={recentSent}
        scheduled={mailbox.scheduled}
        threads={threadsFor(recentSent, messages, inbound)}
        counts={mailbox.counts}
      />

      <SignalsCard
        signals={signals.length ? signals : EXAMPLE_SIGNALS}
        isExample={signals.length === 0}
      />

      <ActivityCard
        periods={buildAllPeriods({ messages, inbound, prospects, deals })}
        initialSeries={parseSeriesParam(searchParams.kpi)}
      />

      {pilotage && (
        <section id="pilotage" className="scroll-mt-24">
          <PilotageCard consumption={pilotage.consumption} credits={pilotage.credits} />
        </section>
      )}
    </div>
  );
}
