import { BarChart3 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { formatEur } from "@/lib/utils";
import type { Deal, Message, Prospect } from "@/types";
import { countValued, dealValue, sumPipeline } from "../suivi/_lib/estimates";
import { FunnelBars } from "./_charts/funnel-bars";
import { MonthBars } from "./_charts/month-bars";
import { AiInsightsSlot, WhatWorks } from "./_components/insights";
import { KpiTile } from "./_components/kpi-tile";
import { ResponseBreakdown } from "./_components/response-breakdown";
import { buildInsights } from "./_lib/insights";
import {
  buildFunnel,
  contactedSeries,
  repliedSeries,
  responseBySector,
  responseBySequence,
  responseBySignal,
  responseDelay,
  revenueByMonth,
  signedRevenue,
} from "./_lib/metrics";

export const metadata = { title: "Stats · ORION" };

/** Prospects encore en jeu : ils composent la valeur de pipeline. */
const OPEN_STATUSES = ["contacte", "relance_1", "relance_2", "repondu", "en_discussion"] as const;

export default async function StatsPage() {
  await requireUser();
  const supabase = createClient();

  const [prospectsResult, messagesResult, dealsResult] = await Promise.all([
    supabase.from("prospects").select("*"),
    supabase.from("messages").select("*"),
    supabase.from("deals").select("*"),
  ]);

  const prospects = (prospectsResult.data ?? []) as Prospect[];
  const messages = (messagesResult.data ?? []) as Message[];
  const deals = (dealsResult.data ?? []) as Deal[];

  if (prospects.length === 0) {
    return (
      <>
        <PageHeader title="Stats" description="Ce que la prospection produit vraiment." />
        <EmptyState
          icon={<BarChart3 />}
          title="Rien à mesurer pour l'instant"
          description="Ajoutez des prospects depuis la Recherche : les indicateurs se remplissent dès le premier message envoyé."
        />
      </>
    );
  }

  const funnel = buildFunnel(prospects, messages);
  const contacted = contactedSeries(messages, 30);
  const replied = repliedSeries(prospects, 30);
  const delay = responseDelay(prospects, messages);
  const revenue = signedRevenue(deals);
  const months = revenueByMonth(deals, 6);

  const bySector = responseBySector(prospects);
  const bySequence = responseBySequence(prospects, messages);
  const bySignal = responseBySignal(prospects);
  const insights = buildInsights({ funnel, bySector, bySequence, bySignal, delay });

  const contactedTotal = contacted.reduce((sum, point) => sum + point.value, 0);
  const [, contactedStage, repliedStage] = funnel;
  const replyRate = contactedStage.count > 0 ? repliedStage.count / contactedStage.count : 0;

  // Valeur de pipeline : montants réels des deals + fourchettes d'exemple.
  const dealsByProspect = new Map<string, Deal[]>();
  for (const deal of deals) {
    dealsByProspect.set(deal.prospect_id, [...(dealsByProspect.get(deal.prospect_id) ?? []), deal]);
  }
  const openValues = prospects
    .filter((prospect) => OPEN_STATUSES.includes(prospect.status as (typeof OPEN_STATUSES)[number]))
    .map((prospect) => dealValue(dealsByProspect.get(prospect.id) ?? []));
  const pipeline = sumPipeline(openValues);
  const valued = countValued(openValues);

  return (
    <>
      <PageHeader
        title="Stats"
        description={`${prospects.length} prospect${prospects.length > 1 ? "s" : ""} suivis · ${contactedStage.count} contactés · ${revenue.count} contrat${revenue.count > 1 ? "s" : ""} signé${revenue.count > 1 ? "s" : ""}.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          featured
          label="Contactés (30 jours)"
          value={String(contactedTotal)}
          hint={`${contactedStage.count} au total depuis le début`}
          series={contacted.map((point) => point.value)}
          seriesId="contacted"
          seriesLabel="Premiers contacts par jour sur 30 jours"
        />
        <KpiTile
          label="Taux de réponse"
          value={`${Math.round(replyRate * 100)} %`}
          hint={`${repliedStage.count} réponse(s) sur ${contactedStage.count} contactés`}
          series={replied.map((point) => point.value)}
          seriesId="replied"
          seriesLabel="Réponses par jour sur 30 jours"
          tone="good"
        />
        <KpiTile
          label="Délai de réponse"
          value={delay.medianDays === null ? "—" : `${delay.medianDays} j`}
          hint={
            delay.sample === 0
              ? "Aucune réponse mesurable pour l'instant"
              : `Médiane estimée sur ${delay.sample} réponse(s)`
          }
          tone="warn"
        />
        <KpiTile
          label="Valeur du pipeline"
          value={valued > 0 ? formatEur(pipeline) : "—"}
          hint={
            valued > 0
              ? `Montants estimés saisis sur ${valued} prospect${valued > 1 ? "s" : ""} ouvert${valued > 1 ? "s" : ""}`
              : "Aucun montant estimé saisi — renseignez-le depuis la fiche prospect"
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Entonnoir</CardTitle>
            <CardDescription>De la base de prospects au contrat signé.</CardDescription>
          </CardHeader>
          <CardContent>
            <FunnelBars stages={funnel} />
          </CardContent>
        </Card>

        <ResponseBreakdown bySector={bySector} bySequence={bySequence} bySignal={bySignal} />

        <WhatWorks insights={insights} />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Chiffre d&apos;affaires signé</CardTitle>
            <CardDescription>
              {revenue.count === 0
                ? "Aucun contrat enregistré : le graphe se remplit au premier passage en « Gagné »."
                : `${formatEur(revenue.amount)} sur ${revenue.count} contrat(s), mois par mois.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MonthBars points={months} />
          </CardContent>
        </Card>

        <AiInsightsSlot />
      </div>
    </>
  );
}
