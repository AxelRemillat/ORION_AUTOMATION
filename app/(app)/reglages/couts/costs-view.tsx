import { Wallet } from "lucide-react";
import {
  Badge,
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
import { activeProspectCount } from "@/lib/trash/scope";
import { requireUser } from "@/lib/auth";
import { formatEur } from "@/lib/utils";
import { fetchBalances } from "@/lib/usage/balances";
import { SERVICE_LABELS, USD_EUR_RATE } from "@/lib/usage/pricing";
import type { ApiUsage } from "@/types";
import { aggregate, perProspect, remainingProspects } from "./_lib/aggregate";
import { ServiceTable } from "./_components/service-table";



/**
 * Couts et consommation.
 *
 * Tout ce qui est affiche vient de deux sources, jamais melangees : la table
 * `api_usage` (ce que l'app a consomme, exact) et les APIs des fournisseurs
 * (ce qu'il reste chez eux, exact quand l'endpoint existe). Les cles restent
 * cote serveur : cette page est un Server Component et n'expose rien.
 */
export async function CostsView() {
  await requireUser();
  const supabase = createClient();

  const [usageResult, prospectsResult] = await Promise.all([
    supabase.from("api_usage").select("*").order("created_at", { ascending: false }),
    activeProspectCount(supabase),
  ]);

  const rows = (usageResult.data ?? []) as ApiUsage[];
  const prospects = prospectsResult.count ?? 0;

  const totals = aggregate(rows);
  const average = perProspect(totals, prospects);

  const balances = await fetchBalances({
    openaiEur: totals.byService.find((entry) => entry.service === "openai")?.cost ?? 0,
    pappersCredits: totals.byService.find((entry) => entry.service === "pappers")?.units ?? 0,
  });

  const remaining = average ? remainingProspects(balances, average, SERVICE_LABELS) : null;

  return (
    <>
      <PageHeader
        title="Coûts & consommation"
        description="Ce que l'app a réellement consommé chez chaque fournisseur, et ce qu'il reste."
      />

      {totals.totalCalls === 0 ? (
        <EmptyState
          icon={<Wallet aria-hidden />}
          title="Aucune consommation enregistrée"
          description="Les appels aux APIs sont comptabilisés dès la première recherche enrichie ou la première génération d'email."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Coût total engagé"
              value={totals.totalCost > 0 ? formatEur(totals.totalCost) : "—"}
              hint={`${totals.totalCalls} appel${totals.totalCalls > 1 ? "s" : ""} facturé${
                totals.totalCalls > 1 ? "s" : ""
              } · services sans prix configuré exclus`}
            />
            <StatCard
              label="Coût moyen par prospect"
              value={average && average.cost > 0 ? formatEur(average.cost) : "—"}
              hint={
                average
                  ? `Coût total ÷ ${average.prospects} prospect${average.prospects > 1 ? "s" : ""} en base`
                  : "Aucun prospect enregistré"
              }
            />
            <StatCard
              label="Prospects restants"
              value={remaining ? String(remaining.prospects) : "—"}
              hint={
                remaining
                  ? `${remaining.exact ? "Ressource mesurée" : "Estimation"} — ${remaining.basis}`
                  : "Nécessite un solde fournisseur et une consommation moyenne connue"
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Par service</CardTitle>
              <CardDescription>
                La colonne « Consommé » est exacte : elle compte les appels réellement passés par
                l&apos;app. La colonne « Reste » est marquée <strong>exact</strong> quand elle vient
                de l&apos;API du fournisseur, <strong>estimé</strong> quand l&apos;app la
                reconstitue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ServiceTable usage={totals.byService} balances={balances} labels={SERVICE_LABELS} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-2 p-5 text-[13px] leading-relaxed text-muted">
              <p className="flex items-center gap-2">
                <Badge tone="neutral">méthode</Badge>
              </p>
              <p>
                Les coûts OpenAI sont calculés sur le champ <span className="font-data">usage</span>{" "}
                renvoyé par l&apos;API — donc sur les tokens réellement facturés, pas sur une
                estimation de longueur.
              </p>
              <p>
                Les montants en dollars (OpenAI, Linkup) sont convertis au taux{" "}
                <span className="font-data">{USD_EUR_RATE}</span>, approximatif et réglable via{" "}
                <span className="font-data">USD_EUR_RATE</span>. Pappers et Hunter sont facturés au
                forfait : leur consommation est exacte, mais leur coût en euros n&apos;apparaît que
                si vous renseignez <span className="font-data">PAPPERS_CREDIT_EUR</span> et{" "}
                <span className="font-data">HUNTER_SEARCH_EUR</span>.
              </p>
              <p>
                Ce tableau ne compte que ce que <strong>cette app</strong> a consommé. Un appel
                passé ailleurs avec la même clé n&apos;y figure pas — d&apos;où l&apos;intérêt des
                soldes fournisseurs, qui font foi.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
