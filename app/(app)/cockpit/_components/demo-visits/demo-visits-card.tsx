import { MousePointerClick } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import type { DemoRow } from "@/lib/demo-visits/model";

/**
 * « Démos ouvertes depuis les mails » (Cowork #34) : par lien de démo (démo × v),
 * mails envoyés qui le portent, arrivées sur le portfolio, démos lancées — sur
 * 7 et 30 jours. Des compteurs agrégés : on ne sait pas QUI a ouvert, seulement
 * combien. Un lien sans v= n'est jamais compté côté portfolio.
 */
const LABELS: Record<string, string> = { email: "Tri des e-mails", invoice: "Factures", agent: "Agent devis", meeting: "Compte rendu", dataclean: "Fichier clients", sav: "SAV" };

function Pair({ d7, d30 }: { d7: number; d30: number }) {
  return (
    <span className="font-data">
      {d7} <span className="text-faint">/ {d30}</span>
    </span>
  );
}

export function DemoVisitsCard({ rows }: { rows: DemoRow[] }) {
  const total = rows.reduce((sum, row) => ({ sent: sum.sent + row.sent.d30, arrivals: sum.arrivals + row.arrivals.d30, starts: sum.starts + row.starts.d30 }), { sent: 0, arrivals: 0, starts: 0 });
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MousePointerClick className="h-4 w-4 text-primary" aria-hidden />
          <CardTitle>Démos ouvertes depuis les mails</CardTitle>
        </div>
        <CardDescription>
          Par lien de démo : mails envoyés, arrivées sur le site, démos lancées. Chiffres « 7 jours / 30 jours », agrégés — jamais par prospect.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-[13px] text-muted">Aucun mail avec un lien de démo sur les 30 derniers jours.</p>
        ) : (
          <>
            <p className="text-[13px] text-muted">
              30 jours : <strong className="font-data text-text">{total.sent}</strong> liens envoyés, <strong className="font-data text-text">{total.arrivals}</strong> arrivées,{" "}
              <strong className="font-data text-text">{total.starts}</strong> démos lancées.
            </p>
            <Table>
              <THead>
                <TR>
                  <TH>Lien</TH>
                  <TH className="text-right">Mails envoyés</TH>
                  <TH className="text-right">Arrivées</TH>
                  <TH className="text-right">Démos lancées</TH>
                  <TH className="text-right">Abouties</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={`${row.demo}|${row.v}`}>
                    <TD>
                      <span className="text-[13px] text-text">{LABELS[row.demo] ?? row.demo}</span>{" "}
                      <span className="font-data text-[12px] text-muted">{row.v === "—" ? "sans v= (non mesurable)" : `v=${row.v}`}</span>
                    </TD>
                    <TD className="text-right"><Pair {...row.sent} /></TD>
                    <TD className="text-right"><Pair {...row.arrivals} /></TD>
                    <TD className="text-right"><Pair {...row.starts} /></TD>
                    <TD className="text-right"><Pair {...row.results} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
