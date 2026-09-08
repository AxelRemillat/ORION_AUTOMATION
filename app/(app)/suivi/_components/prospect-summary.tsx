import { ExternalLink } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle, DealStatusBadge } from "@/components/ui";
import { formatDate, formatEur } from "@/lib/utils";
import type { Deal, Prospect, Reminder } from "@/types";

const numberFormat = new Intl.NumberFormat("fr-FR");

/** Ligne libellé / valeur des chiffres clés. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-right text-[13px] font-medium text-fg">{value}</span>
    </div>
  );
}

/** Colonne de droite de la fiche : identité, chiffres clés, signaux, contrats, relances. */
export function ProspectSummary({
  prospect,
  deals,
  reminders,
}: {
  prospect: Prospect;
  deals: Deal[];
  reminders: Reminder[];
}) {
  const figures = prospect.key_figures ?? {};
  const openReminders = reminders.filter((reminder) => !reminder.done);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Chiffres clés</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <Row label="Secteur" value={prospect.sector ?? "—"} />
          <Row label="Ville" value={prospect.city ?? "—"} />
          <Row label="Taille" value={prospect.size_range ?? "—"} />
          <Row label="SIREN" value={prospect.siren ?? "—"} />
          <Row
            label="CA connu"
            value={typeof figures.revenue_eur === "number" ? formatEur(figures.revenue_eur) : "—"}
          />
          <Row
            label="Effectif"
            value={
              typeof figures.headcount === "number" ? numberFormat.format(figures.headcount) : "—"
            }
          />
          <Row label="Créée en" value={figures.founded_year ?? "—"} />
          <Row
            label="Site"
            value={
              prospect.website ? (
                <a
                  href={prospect.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  Ouvrir
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : (
                "—"
              )
            }
          />
        </CardContent>
      </Card>

      {prospect.signals?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Signaux</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {prospect.signals.map((signal, index) => (
              <div key={`${signal.label}-${index}`} className="text-[13px]">
                <p className="text-fg">{signal.label}</p>
                <p className="text-[12px] text-muted">
                  {[signal.source, signal.date ? formatDate(signal.date) : null]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Contrats</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {deals.length === 0 && <p className="text-[13px] text-muted">Aucun contrat enregistré.</p>}
          {deals.map((deal) => (
            <div key={deal.id} className="flex items-center justify-between gap-2">
              <DealStatusBadge status={deal.status} />
              <span className="text-[13px] font-medium tabular-nums text-fg">
                {formatEur(deal.amount_eur)}
              </span>
              <span className="text-[12px] text-muted">{formatDate(deal.signed_at)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Relances programmées</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {openReminders.length === 0 && (
            <p className="text-[13px] text-muted">Aucune relance en attente.</p>
          )}
          {openReminders.map((reminder) => (
            <div key={reminder.id} className="flex items-center gap-2 text-[13px]">
              <Badge tone="info">{formatDate(reminder.due_at)}</Badge>
              <span className="text-muted">à relancer</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
