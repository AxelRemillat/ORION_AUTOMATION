import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge, Card, CardContent } from "@/components/ui";
import type { FunnelCard as Card_ } from "@/lib/funnel/view";
import { HUNTER_EPUISE } from "@/lib/hunter/gate";

/**
 * Une carte de l'entonnoir : le signal daté et sa source, le pain probable,
 * le contact trouvé. Le badge « décision au siège » vient du filtre.
 */

const CONTACT = {
  nominatif: { tone: "success", label: "✅ email nominatif" },
  generique: { tone: "warning", label: "🟡 email générique" },
  aucun: { tone: "danger", label: "❌ aucun email" },
} as const;

const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("fr-FR") : "date inconnue");

export function FunnelCard({ card }: { card: Card_ }) {
  const contact = card.contact ? CONTACT[card.contact] : null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px]">{card.companyName}</h3>
            <p className="font-data text-[12px] text-faint">
              {[card.siren, card.city, card.revenue].filter(Boolean).join(" · ")}
            </p>
          </div>
          {card.score != null && <Badge tone="accent" className="font-data">{card.score}/5</Badge>}
        </div>

        <div className="rounded-md border border-line-soft bg-surface-2/60 p-3 text-[13px]">
          <p className="flex flex-wrap items-center gap-2 text-muted">
            <span className="font-data">{day(card.date)}</span>·<span>{card.sourceLabel}</span>
            {card.url && (
              <a href={card.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-ink hover:underline">
                source <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </p>
          <p className="mt-1 text-text">{card.label}</p>
          {card.newLeader && <p className="mt-1 text-text">Nouvelle direction : {card.newLeader}</p>}
          {card.jobTitle && <p className="mt-1 text-muted">Offre : {card.jobTitle}</p>}
        </div>

        {card.pain && (
          <p className="text-[13px] text-muted">
            Pain probable : <span className="text-text">{card.pain}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {contact && <Badge tone={contact.tone}>{contact.label}</Badge>}
          {card.emailDoubtful && <Badge tone="warning">email douteux : domaine hors site</Badge>}
          {card.statut === "retenu" && <Badge tone="info">en attente de creusage</Badge>}
          {card.badges.map((badge) => (
            <Badge key={badge} tone={badge.startsWith("décision au siège") ? "warning" : "neutral"}>
              {badge}
            </Badge>
          ))}
        </div>

        {card.phone && (
          <p className="text-[13px] text-muted">
            Téléphone (site) :{" "}
            <a href={`tel:${card.phone.replace(/\s/g, "")}`} className="font-data text-primary-ink hover:underline">
              {card.phone}
            </a>
          </p>
        )}

        {card.publication === "a_completer" && card.hunterSkipped && (
          <p className={card.hunterSkipped.startsWith(HUNTER_EPUISE) ? "text-[12px] text-warn-ink" : "text-[12px] text-muted"}>
            {card.hunterSkipped.startsWith(HUNTER_EPUISE)
              ? `À compléter (${HUNTER_EPUISE})`
              : `Hunter non appelé : ${card.hunterSkipped}`}
          </p>
        )}

        {card.prospectId && (
          <Link href={`/suivi/${card.prospectId}`} className="text-[13px] text-primary-ink hover:underline">
            Ouvrir la fiche →
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
