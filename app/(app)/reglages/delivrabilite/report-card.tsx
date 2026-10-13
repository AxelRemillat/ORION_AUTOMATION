import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { rate, type DeliverabilityReport } from "@/lib/settings/deliverability-report";

const frDate = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

/** Point délivrabilité depuis le premier envoi (Cowork #26) : par semaine, par type d'adresse, et le goulot. */
export function ReportCard({ report, advice }: { report: DeliverabilityReport; advice: { go: boolean; text: string } }) {
  const columns: [string, (row: DeliverabilityReport["totals"]) => string][] = [
    ["Intros", (row) => String(row.intros)],
    ["Relances", (row) => String(row.relances)],
    ["Rebonds durs", (row) => `${row.hardBounces} · ${rate(row.hardBounces, row.intros + row.relances)}`],
    ["Rebonds mous", (row) => String(row.softBounces)],
    ["Réponses", (row) => `${row.replies} · ${rate(row.replies, row.intros + row.relances)}`],
    ["Refus / stop", (row) => `${row.stops} · ${rate(row.stops, row.intros + row.relances)}`],
    ["Absences", (row) => String(row.absences)],
    ["Anti-spam", (row) => String(row.antispam)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Point délivrabilité depuis le {frDate(report.since)}</CardTitle>
        <CardDescription className={advice.go ? "text-good-ink" : "text-warn-ink"}>{advice.text}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-3 font-normal">Semaine du</th>
                {columns.map(([label]) => (
                  <th key={label} className="py-1 pr-3 font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-data">
              {[...report.weeks, report.totals].map((row) => (
                <tr key={row.week} className={row.week === "total" ? "border-t border-line font-medium text-text" : "text-text"}>
                  <td className="py-1 pr-3">{row.week === "total" ? "Total" : frDate(row.week)}</td>
                  {columns.map(([label, cell]) => (
                    <td key={label} className="py-1 pr-3">
                      {cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["nominative", "generique"] as const).map((kind) => {
            const value = report.bouncesByKind[kind];
            return (
              <div key={kind} className="rounded-lg border border-line bg-surface-2/60 p-3 text-[12px]">
                <span className="text-muted">Adresses {kind === "nominative" ? "nominatives" : "génériques"}</span>
                <p className="font-data text-[14px] text-text">{value.sent} envois · {value.hard} dur(s) · {value.soft} mou(s)</p>
              </div>
            );
          })}
          <div className="rounded-lg border border-line bg-surface-2/60 p-3 text-[12px]">
            <span className="text-muted">Mails prêts ≥ 9/10 par jour ouvré (le vrai goulot)</span>
            <p className="font-data text-[14px] text-text">{report.readyPerBusinessDay.toFixed(1).replace(".", ",")}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
