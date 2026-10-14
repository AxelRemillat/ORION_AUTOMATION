import { FlaskConical } from "lucide-react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { MIN_SENT_PER_VARIANT } from "@/lib/experiments/model";
import type { ExperimentStats } from "@/lib/experiments/stats";

/**
 * Encart d'une expérience de mails (Cowork #30) : par variante, envoyés,
 * réponses, positives, refus, absences. Tant qu'une variante a moins de
 * 50 envois, un avertissement dit qu'on ne peut rien conclure.
 * Aucune expérience : le Cockpit n'affiche rien (rien n'est créé par défaut).
 */
const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)} %` : "—");
const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export function ExperimentCard({ experiment }: { experiment: ExperimentStats }) {
  const fewest = Math.min(...experiment.variants.map((variant) => variant.sent));
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" aria-hidden />
          <CardTitle>Expérience : {experiment.name}</CardTitle>
          <Badge tone={experiment.active ? "success" : "neutral"}>{experiment.active ? "Active" : "Inactive"}</Badge>
        </div>
        <CardDescription>
          Seule la phrase d&apos;appel à l&apos;action change d&apos;une variante à l&apos;autre.
          {experiment.startedAt ? ` Depuis le ${DATE.format(new Date(experiment.startedAt))}.` : " Jamais démarrée."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {fewest < MIN_SENT_PER_VARIANT && (
          <p role="status" className="rounded-lg border border-warn/45 bg-warn/15 px-3 py-2 text-[13px] text-warn-ink">
            Moins de {MIN_SENT_PER_VARIANT} envois par variante ({fewest} pour la moins servie) : les écarts ne veulent encore rien dire.
          </p>
        )}
        <Table>
          <THead>
            <TR>
              <TH>Variante</TH>
              <TH className="text-right">Envoyés</TH>
              <TH className="text-right">Réponses</TH>
              <TH className="text-right">Positives</TH>
              <TH className="text-right">Refus</TH>
              <TH className="text-right">Absences</TH>
            </TR>
          </THead>
          <TBody>
            {experiment.variants.map((variant) => (
              <TR key={variant.key}>
                <TD>
                  <span className="font-data text-[12px] text-muted">{variant.key}</span>
                  <span className="block text-[13px] text-text">{variant.cta}</span>
                </TD>
                <TD className="text-right font-data">{variant.sent}</TD>
                <TD className="text-right font-data">
                  {variant.replies} <span className="text-faint">({pct(variant.replies, variant.sent)})</span>
                </TD>
                <TD className="text-right font-data">
                  {variant.positives} <span className="text-faint">({pct(variant.positives, variant.sent)})</span>
                </TD>
                <TD className="text-right font-data">{variant.refusals}</TD>
                <TD className="text-right font-data">{variant.absences}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
