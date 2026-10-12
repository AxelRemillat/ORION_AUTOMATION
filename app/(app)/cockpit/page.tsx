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
import Link from "next/link";
import { OpenAiQuotaBanner } from "@/components/layout/openai-quota-banner";
import { GMAIL_AUTH_MESSAGE, isGmailAuthError } from "@/lib/outbox/send-errors";
import { readPrefs } from "@/lib/funnel/settings";
import { PlatformsCard } from "./_components/platforms/platforms-card";
import { freelanceSources, platformActivity } from "@/lib/opportunities/stats";
import { dueFollowUps } from "@/lib/opportunities/follow-up-due";
import type { Opportunity } from "@/lib/opportunities/types";

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
  const user = await requireUser();
  const supabase = createClient();

  // Corbeille exclue partout : boîte de réception, courbes.
  const [{ prospects, messages, deals, inbound }, pilotage, prefs, opportunities, sentRows] = await Promise.all([
    loadPortfolio(supabase, ["messages", "deals", "inbound"]),
    // Pilotage : agrégats serveur, soldes fournisseurs en cache 1 h. Une panne
    // ici ne doit jamais empêcher le Cockpit de s'afficher.
    loadPilotage(supabase).catch(() => null),
    readPrefs(supabase, user.id).catch(() => null),
    // Plateformes freelance (Opportunités) : jalons des 30 derniers jours. Une panne n'empêche rien.
    loadPlatformRows(supabase).catch(() => [] as PlatformRow[]),
    // Relances dues : toutes les propositions « Envoyées », quelle que soit leur date.
    loadSentRows(supabase).catch(() => [] as SentRow[]),
  ]);
  const now = new Date();
  // Aperçu de la boîte mail : les plus récents ; « Tout voir » → /cockpit/mails.
  const mailbox = buildMailbox({ prospects, messages, inbound });
  const recentSent = mailbox.sent.slice(0, 10);
  /*
   * « N réponses à traiter » parle du TRAVAIL qui reste, pas de ce qui n'a pas
   * été ouvert : un mail lu mais sans réponse reste à traiter. C'est donc
   * `handled` (soldé) qu'on compte ici, et `read_at` qui pilote le badge
   * « non lus » de la barre (lib/badges/counts).
   */
  const toHandle = inbound.filter((message) => !message.deleted_at && !message.handled).length;
  // Mails en échec parce que la connexion Gmail de n8n a expiré : bandeau rouge.
  const gmailFailures = messages.filter(
    (message) => message.send_status === "failed" && !message.deleted_at && isGmailAuthError(message.send_error),
  ).length;
  // Challenges anti-spam pas encore validés : signalés tant que « Validé » n'est pas coché
  // (Axel ne regarde pas Gmail, la boîte ORION est son seul point de contrôle).
  const antispamPending = mailbox.received.filter((entry) => entry.autoKind === "antispam" && !entry.validated).length;
  const date = DATE_FORMAT.format(new Date());
  const subtitle = toHandle
    ? `${toHandle} réponse${toHandle > 1 ? "s" : ""} à traiter. Commencez par là.`
    : prospects.length
    ? `${prospects.length} prospect${prospects.length > 1 ? "s" : ""} en portefeuille. La file du jour est dans « Aujourd'hui ».`
    : "Votre portefeuille est vide : l'écran se remplira dès vos premiers prospects.";

  return (
    <div className="flex flex-col gap-6">
      <CockpitHeader
        title="Cockpit"
        subtitle={subtitle}
        date={date.charAt(0).toUpperCase() + date.slice(1)}
        sources={freelanceSources(opportunities, now)}
        followUpsDue={dueFollowUps(sentRows, now).length}
      />

      <OpenAiQuotaBanner />

      {gmailFailures > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-lost/25 bg-lost/10 px-4 py-3 text-[13px] text-lost-ink">
          <span>
            <strong>{gmailFailures} mail{gmailFailures > 1 ? "s" : ""} en échec</strong> — {GMAIL_AUTH_MESSAGE}.
          </span>
          <Link href="/cockpit/mails?onglet=envoyes" className="font-medium underline-offset-2 hover:underline">
            Voir les envois en échec
          </Link>
        </div>
      )}

      {antispamPending > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/45 bg-warn/15 px-4 py-3 text-[13px] text-warn-ink">
          <span>
            <strong>
              {antispamPending} mail{antispamPending > 1 ? "s" : ""} bloqué{antispamPending > 1 ? "s" : ""} par un anti-spam : à valider
            </strong>{" "}
            — ouvrez le lien de validation, puis cochez « Validé ».
          </span>
          <Link href="/cockpit/mails?onglet=recus" className="font-medium underline-offset-2 hover:underline">
            Voir les mails reçus
          </Link>
        </div>
      )}

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

      <PlatformsCard week={platformActivity(opportunities, 7, now)} month={platformActivity(opportunities, 30, now)} />

      {pilotage && (
        <section id="pilotage" className="scroll-mt-24">
          <PilotageCard
            consumption={pilotage.consumption}
            credits={pilotage.credits}
            openai={pilotage.openai}
            readiness={pilotage.readiness}
            target={prefs?.dailyTarget ?? null}
          />
        </section>
      )}
    </div>
  );
}

type PlatformRow = Pick<Opportunity, "platform" | "status" | "sent_at" | "replied_at" | "updated_at" | "conversation_at" | "won_at">;

/** Opportunités touchées ces 30 derniers jours (jalons datés), pour la carte « Plateformes freelance ». */
async function loadPlatformRows(supabase: ReturnType<typeof createClient>): Promise<PlatformRow[]> {
  const since = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const db = supabase as unknown as { from: (table: string) => any };
  const { data, error } = await db
    .from("opportunities")
    .select("platform, status, sent_at, replied_at, updated_at, conversation_at, won_at")
    .gte("updated_at", since)
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as PlatformRow[];
}

type SentRow = Pick<Opportunity, "platform" | "status" | "sent_at" | "replied_at" | "followed_up_at">;

/** Propositions « Envoyées » (relances dues, plateformes #6). */
async function loadSentRows(supabase: ReturnType<typeof createClient>): Promise<SentRow[]> {
  const db = supabase as unknown as { from: (table: string) => any };
  const { data, error } = await db.from("opportunities").select("platform, status, sent_at, replied_at, followed_up_at").eq("status", "envoyee").limit(2000);
  if (error) throw error;
  return (data ?? []) as SentRow[];
}
