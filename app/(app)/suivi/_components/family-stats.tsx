import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { ALL_FAMILIES, FAMILY_LABELS } from "@/lib/emails/quality/families";
import { SIGNIFICANT_SENDS, type ValueStats } from "@/lib/variants/stats";

/** Expérience n° 2 : envois, réponses et taux de réponse par famille de mail (F1 à F4). */

const pct = (value: number) => `${Math.round(value * 100)} %`;

export function FamilyStats({ rows }: { rows: ValueStats[] }) {
  const byFamily = new Map(rows.map((row) => [row.value, row]));
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Familles de mails</CardTitle>
        <CardDescription>
          Réponses aux intros envoyées, par famille. Sous {SIGNIFICANT_SENDS} envois, une famille n&apos;est « pas significative » : ne rien conclure.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-faint">
                <th className="py-1 pr-2 font-normal">Famille</th>
                <th className="py-1 pr-2 text-right font-normal">Envois</th>
                <th className="py-1 pr-2 text-right font-normal">Réponses</th>
                <th className="py-1 text-right font-normal">Taux</th>
              </tr>
            </thead>
            <tbody>
              {ALL_FAMILIES.map((family) => {
                const row = byFamily.get(family);
                return (
                  <tr key={family} className="border-t border-line-soft">
                    <td className="py-1 pr-2 text-text">
                      <span className="mr-1.5 font-data text-[11px] text-primary-ink">{family}</span>
                      {FAMILY_LABELS[family]}
                      {row && !row.significant && <span className="ml-1.5 text-[11px] text-faint">pas significatif</span>}
                    </td>
                    <td className="py-1 pr-2 text-right font-data">{row?.sends ?? 0}</td>
                    <td className="py-1 pr-2 text-right font-data">{row?.replies ?? 0}</td>
                    <td className="py-1 text-right font-data text-good-ink">{row ? pct(row.replyRate) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
