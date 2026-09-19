"use client";

import { AtSign, Copy, Target } from "lucide-react";
import { Badge, Button, Card, CardContent, useToast } from "@/components/ui";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import type { Evidence } from "./types";

/**
 * Restitution de l'analyse IA : l'hypothese de pain point, puis les FAITS
 * REELS qui la soutiennent, chacun avec sa provenance.
 *
 * Volontairement pas de grandes tuiles chiffrees ici : elles donnaient a des
 * estimations l'apparence de mesures. Ce panneau n'affiche que des donnees
 * effectivement collectees sur le prospect.
 */
export function AnalysisPanel({
  painPoint,
  evidence,
  contact,
}: {
  painPoint: string;
  evidence: Evidence[];
  contact: DecisionMakerContact | null;
}) {
  const toast = useToast();

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-primary/30" style={{ background: "var(--primary-soft)" }}>
        <CardContent className="flex items-start gap-3 p-5">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-medium text-muted">Pain point supposé</p>
              <Badge tone="neutral">hypothèse</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-text">{painPoint}</p>
          </div>
        </CardContent>
      </Card>

      {evidence.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <p className="font-data text-[11px] font-medium uppercase tracking-wide text-muted">
              Faits réels retenus
            </p>
            <ul className="mt-3 flex flex-col divide-y divide-line-soft">
              {evidence.map((fact) => (
                <li
                  key={`${fact.label}-${fact.value}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="text-[13px] text-muted">{fact.label}</span>
                  <span className="flex-1 text-right text-sm font-medium text-text">
                    {fact.value}
                  </span>
                  <span className="font-data text-[11px] text-faint">{fact.source}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {contact && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-start gap-2.5">
              <AtSign className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div className="text-[13px]">
                <p className="font-data font-medium text-text">{contact.email}</p>
                <p className="text-muted">
                  {[contact.full_name, contact.position].filter(Boolean).join(" · ") ||
                    "Contact identifié via Hunter"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {contact.confidence != null && (
                <Badge tone={contact.confidence >= 80 ? "success" : "warning"}>
                  {contact.confidence}% de confiance
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard
                    .writeText(contact.email)
                    .then(() => toast.success("Email copié."))
                    .catch(() => toast.error("Copie impossible."));
                }}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Copier
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
