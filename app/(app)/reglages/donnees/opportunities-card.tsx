import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PLATFORM_LABELS } from "@/lib/opportunities/types";
import type { PlatformStats } from "@/lib/opportunities/stats";
import { formatEur } from "@/lib/utils";

const pct = (value: number) => `${Math.round(value * 100)} %`;

/** Opportunités par plateforme : propositions envoyées, taux de réponse, gagnées, CA signé. */
export function OpportunitiesCard({ rows }: { rows: PlatformStats[] }) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Opportunités par plateforme</CardTitle>
        <CardDescription>Propositions envoyées depuis Opportunités, réponses, missions gagnées et chiffre d&apos;affaires signé.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-[13px] text-faint">Aucune opportunité saisie pour l&apos;instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-faint">
                  <th className="py-1 pr-2 font-normal">Plateforme</th>
                  <th className="py-1 pr-2 text-right font-normal">Propositions</th>
                  <th className="py-1 pr-2 text-right font-normal">Réponse</th>
                  <th className="py-1 pr-2 text-right font-normal">Gagnées</th>
                  <th className="py-1 text-right font-normal">CA signé</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.platform} className="border-t border-line-soft">
                    <td className="py-1 pr-2 text-text">{PLATFORM_LABELS[row.platform]}</td>
                    <td className="py-1 pr-2 text-right font-data">{row.sent}</td>
                    <td className="py-1 pr-2 text-right font-data text-good-ink">{row.sent ? pct(row.replyRate) : "—"}</td>
                    <td className="py-1 pr-2 text-right font-data">{row.won}</td>
                    <td className="py-1 text-right font-data">{formatEur(row.revenueEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
