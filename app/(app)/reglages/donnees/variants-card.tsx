import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { SIGNIFICANT_SENDS, VARIANT_ATTRIBUTES, type ValueStats, type VariantAttribute } from "@/lib/variants/stats";

/** Ce qui marche : taux de réponse, rebond et « stop » par valeur de chaque attribut des mails envoyés. */

const pct = (value: number) => `${Math.round(value * 100)} %`;

function AttributeTable({ label, rows }: { label: string; rows: ValueStats[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12px] font-medium text-muted">{label}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[13px]">
          <thead>
            <tr className="text-left text-[11px] text-faint">
              <th className="py-1 pr-2 font-normal">Valeur</th>
              <th className="py-1 pr-2 text-right font-normal">Envois</th>
              <th className="py-1 pr-2 text-right font-normal">Réponse</th>
              <th className="py-1 pr-2 text-right font-normal">Rebond</th>
              <th className="py-1 text-right font-normal">« Stop »</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.value} className="border-t border-line-soft">
                <td className="max-w-[220px] truncate py-1 pr-2 text-text" title={row.value}>
                  {row.value}
                  {!row.significant && <span className="ml-1.5 text-[11px] text-faint">pas significatif</span>}
                </td>
                <td className="py-1 pr-2 text-right font-data">{row.sends}</td>
                <td className="py-1 pr-2 text-right font-data text-good-ink">{pct(row.replyRate)}</td>
                <td className="py-1 pr-2 text-right font-data">{pct(row.bounceRate)}</td>
                <td className="py-1 text-right font-data">{pct(row.stopRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function VariantsCard({ sends, stats }: { sends: number; stats: Record<VariantAttribute, ValueStats[]> }) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Ce qui marche</CardTitle>
        <CardDescription>
          Réactions aux mails envoyés, par variante. Une valeur sous {SIGNIFICANT_SENDS} envois n&apos;est « pas significative » : ne rien conclure.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sends === 0 ? (
          <p className="text-[13px] text-faint">
            Aucun mail envoyé avec sa variante enregistrée pour l&apos;instant. Les chiffres apparaîtront au fil des envois (comptez 1 à 3 mois pour des tendances fiables).
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {VARIANT_ATTRIBUTES.map(({ key, label }) => (
              <AttributeTable key={key} label={label} rows={stats[key]} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
