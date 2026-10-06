import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle, DealStatusBadge } from "@/components/ui";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { HEAT_LEVEL_LABELS, heatContextOf, heatScore } from "@/lib/scoring";
import { formatDate, formatEur } from "@/lib/utils";
import type { Deal, Prospect, Reminder } from "@/types";

const numberFormat = new Intl.NumberFormat("fr-FR");

/** Ligne libellé / valeur des chiffres clés. */
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-data text-right text-[13px] text-text">{value}</span>
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

  const score = heatScore(prospect.signals, {
    seed: prospect.company_name,
    context: heatContextOf(figures),
  });
  const leaderVia = typeof figures.leader_via === "string" ? figures.leader_via : null;
  const leaderPerson = typeof figures.leader_person === "string" ? figures.leader_person : null;
  const groupEvidence = Array.isArray(figures.group_evidence)
    ? (figures.group_evidence as unknown[]).filter((item): item is string => typeof item === "string")
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-baseline justify-between gap-3">
            <CardTitle>Score de chaleur</CardTitle>
            <span className="font-data text-[15px] text-text">
              {score.value}
              <span className="text-faint">/100</span>
            </span>
          </div>
          <p className="text-[12px] text-faint">
            {HEAT_LEVEL_LABELS[score.level]}
            {score.real ? "" : " — score de démonstration, aucun signal exploitable"}
          </p>
        </CardHeader>
        <CardContent>
          <ScoreBreakdown lines={score.breakdown} className="divide-y divide-[var(--line-soft)]" />
          {figures.is_large_group_subsidiary === true && (
            <p className="mt-3 rounded-lg px-3 py-2 text-[12px] leading-snug" style={{ background: "var(--lost-soft)", color: "var(--lost)" }}>
              Décision probablement au niveau groupe.
              {groupEvidence.length > 0 && (
                <span className="mt-1 block text-faint">{groupEvidence.join(" · ")}</span>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chiffres clés</CardTitle>
        </CardHeader>
        <CardContent className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
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
            label="Dirigeant"
            value={
              leaderPerson
                ? `${leaderPerson}${leaderVia ? ` (via ${leaderVia})` : ""}`
                : "—"
            }
          />
          <Row
            label="Contact"
            value={
              prospect.email
                ? [prospect.email, [prospect.contact_name, prospect.contact_role].filter(Boolean).join(" — ")].filter(Boolean).join(" · ")
                : "—"
            }
          />
          <Row
            label="Site"
            value={
              prospect.website ? (
                <a
                  href={prospect.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
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
          <CardContent className="space-y-2.5">
            {prospect.signals.map((signal, index) => (
              <div key={`${signal.label}-${index}`} className="text-[13px]">
                <p className="leading-snug text-text">{signal.label}</p>
                <p className="font-data text-[11px] text-faint">
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
          {deals.length === 0 && <p className="text-[13px] text-faint">Aucun contrat enregistré.</p>}
          {deals.map((deal) => (
            <div key={deal.id} className="flex items-center justify-between gap-2">
              <DealStatusBadge status={deal.status} />
              <span className="font-data text-[13px] text-text">{formatEur(deal.amount_eur)}</span>
              <span className="font-data text-[12px] text-faint">{formatDate(deal.signed_at)}</span>
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
            <p className="text-[13px] text-faint">Aucune relance en attente.</p>
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
