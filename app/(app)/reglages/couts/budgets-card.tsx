import Link from "next/link";
import { Gauge } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { formatEur } from "@/lib/utils";
import { COST_PROVIDERS, type Budget, type MonthRow } from "@/lib/settings/costs";
import { SERVICE_LABELS } from "@/lib/usage/pricing";

/** Budgets en vigueur et dépense par fournisseur et par mois. */
export function BudgetsCard({ budgets, months }: { budgets: Budget[]; months: MonthRow[] }) {
  return (
    <div className="mb-6 flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Budgets et forfaits</CardTitle>
            <CardDescription>Les limites que l&apos;app applique. Elles se modifient dans les variables d&apos;environnement (Vercel).</CardDescription>
          </div>
          <Link href="/cockpit#pilotage" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-text hover:bg-surface-2">
            <Gauge className="h-4 w-4" aria-hidden />
            Graphe de consommation (Cockpit)
          </Link>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {budgets.map((budget) => (
              <div key={budget.label} className="flex min-w-0 flex-col">
                <dt className="text-[12px] text-muted">{budget.label}</dt>
                <dd className="font-data text-[14px] text-text">
                  {budget.value} <span className="text-[11px] text-faint">· {budget.source}</span>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dépense par mois</CardTitle>
          <CardDescription>Six derniers mois, heure de Paris. Coûts exacts tels que journalisés à chaque appel.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Mois</TH>
                {COST_PROVIDERS.map((provider) => (
                  <TH key={provider} className="text-right">{SERVICE_LABELS[provider]}</TH>
                ))}
                <TH className="text-right">Total</TH>
              </TR>
            </THead>
            <TBody>
              {months.map((row) => (
                <TR key={row.month}>
                  <TD className="capitalize">{row.label}</TD>
                  {COST_PROVIDERS.map((provider) => (
                    <TD key={provider} className="text-right font-data">
                      {row.byProvider[provider].calls ? formatEur(row.byProvider[provider].eur) : "—"}
                      {row.byProvider[provider].calls > 0 && <span className="block text-[11px] text-faint">{row.byProvider[provider].calls} appels</span>}
                    </TD>
                  ))}
                  <TD className="text-right font-data text-text">{row.total ? formatEur(row.total) : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
