import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPortfolio } from "@/lib/trash/portfolio";
import { CockpitHeader } from "./_components/cockpit-header";
import { MailboxPanel } from "./_components/mailbox/mailbox-panel";
import { buildMailbox, threadsFor } from "./_lib/mailbox-data";
import { ActivityCard } from "./_components/activity/activity-card";
import { buildAllPeriods, parseSeriesParam } from "./_lib/series";
import { PilotageCard } from "./_components/pilotage/pilotage-card";
import { loadPilotage } from "@/lib/usage/pilotage";

export const metadata = { title: "Cockpit — ORION" };

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * COCKPIT — la vue d'ensemble : la boîte mail, l'activité et le pilotage
 * (consommation, crédits, dépense du mois).
 *
 * Ce qu'il faut FAIRE vit désormais dans « Aujourd'hui » (03/10/2026) : la file
 * d'actions et les « signaux les plus forts » ont quitté le Cockpit. Les
 * chiffres détaillés vivent dans Réglages › Données. Tout vient des tables
 * réelles ; rien n'est inventé.
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

  // Corbeille exclue partout : boîte de réception, courbes.
  const [{ prospects, messages, deals, inbound }, pilotage] = await Promise.all([
    loadPortfolio(supabase, ["messages", "deals", "inbound"]),
    // Pilotage : agrégats serveur, soldes fournisseurs en cache 1 h. Une panne
    // ici ne doit jamais empêcher le Cockpit de s'afficher.
    loadPilotage(supabase).catch(() => null),
  ]);
  // Aperçu de la boîte mail : les plus récents ; « Tout voir » → /cockpit/mails.
  const mailbox = buildMailbox({ prospects, messages, inbound });
  const recentSent = mailbox.sent.slice(0, 10);
  const unread = mailbox.counts.nonLus;
  const date = DATE_FORMAT.format(new Date());
  const subtitle = unread
    ? `${unread} réponse${unread > 1 ? "s" : ""} à traiter. Commencez par là.`
    : prospects.length
    ? `${prospects.length} prospect${prospects.length > 1 ? "s" : ""} en portefeuille. La file du jour est dans « Aujourd'hui ».`
    : "Votre portefeuille est vide : l'écran se remplira dès vos premiers prospects.";

  return (
    <div className="flex flex-col gap-6">
      <CockpitHeader
        title="Cockpit"
        subtitle={subtitle}
        date={date.charAt(0).toUpperCase() + date.slice(1)}
      />

      <MailboxPanel
        received={mailbox.received.slice(0, 30)}
        sent={recentSent}
        scheduled={mailbox.scheduled}
        threads={threadsFor(recentSent, messages, inbound)}
        counts={mailbox.counts}
      />

      <ActivityCard
        periods={buildAllPeriods({ messages, inbound, prospects, deals })}
        initialSeries={parseSeriesParam(searchParams.kpi)}
      />

      {pilotage && (
        <section id="pilotage" className="scroll-mt-24">
          <PilotageCard consumption={pilotage.consumption} credits={pilotage.credits} openai={pilotage.openai} />
        </section>
      )}
    </div>
  );
}
