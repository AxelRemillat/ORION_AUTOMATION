import { BarChart3 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatCard,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { formatEur } from "@/lib/utils";
import { PIPELINE_ORDER } from "@/lib/constants";
import {
  PipelineChart,
  RateChart,
  RevenueChart,
  TrendChart,
  contactedOverTime,
  countByStatus,
  funnelStats,
  revenueByMonth,
  totalRevenue,
} from "@/lib/charts";
import type { Deal, Message, Prospect } from "@/types";

export const metadata = { title: "Stats — Prospect" };

/** Dashboard : tuiles KPI + 4 graphes, calculés à la volée depuis Supabase. */
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

  const stats = funnelStats(prospects, messages);
  const revenue = totalRevenue(deals);
  const wonDeals = deals.filter((deal) => deal.status === "gagne").length;

  const trend = contactedOverTime(messages, 30);
  const revenueSeries = revenueByMonth(deals, 6);
  const pipeline = countByStatus(prospects, PIPELINE_ORDER);

  if (prospects.length === 0) {
    return (
      <>
        <PageHeader title="Stats" description="Performance de la prospection." />
        <EmptyState
          icon={<BarChart3 />}
          title="Rien à mesurer pour l'instant"
          description="Ajoutez des prospects depuis la Recherche : les indicateurs apparaîtront ici dès le premier message envoyé."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Stats"
        description={`${prospects.length} prospect${prospects.length > 1 ? "s" : ""} dans la base.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Contactés"
          value={stats.contacted}
          hint={`${Math.round(stats.replyRate * 100)} % de réponses`}
        />
        <StatCard
          label="En discussion"
          value={stats.inDiscussion}
          hint={`${stats.replied} réponse${stats.replied > 1 ? "s" : ""} au total`}
        />
        <StatCard
          label="Gagnés"
          value={stats.won}
          hint={`${Math.round(stats.successRate * 100)} % des répondus`}
        />
        <StatCard
          label="CA signé"
          value={formatEur(revenue)}
          hint={`${wonDeals} contrat${wonDeals > 1 ? "s" : ""}`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Prospects contactés</CardTitle>
            <CardDescription>
              Premiers contacts par jour sur 30 jours, et cumul sur la période.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart data={trend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Taux de conversion</CardTitle>
            <CardDescription>
              Relance et réponse sur les contactés ({stats.contacted}), succès sur les répondus (
              {stats.replied}).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RateChart stats={stats} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Répartition du pipeline</CardTitle>
            <CardDescription>Où en sont les prospects, étape par étape.</CardDescription>
          </CardHeader>
          <CardContent>
            <PipelineChart data={pipeline} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Chiffre d&apos;affaires signé</CardTitle>
            <CardDescription>Montant et nombre de contrats gagnés, par mois.</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueChart data={revenueSeries} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
