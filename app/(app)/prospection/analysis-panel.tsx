"use client";

import { AtSign, Copy, Target } from "lucide-react";
import { Badge, Button, Card, CardContent, StatCard, useToast } from "@/components/ui";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import type { Lever } from "./types";

/**
 * Restitution de l'analyse IA : le pain point identifié, puis les 3 chiffres
 * (volume → heures → euros) qui serviront de levier dans l'email.
 */
export function AnalysisPanel({
  painPoint,
  levers,
  contact,
}: {
  painPoint: string;
  levers: Lever[];
  contact: DecisionMakerContact | null;
}) {
  const toast = useToast();

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-accent/30 bg-accent/5">
        <CardContent className="flex items-start gap-3 p-5">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <div>
            <p className="text-[13px] font-medium text-muted">Pain point automatisable</p>
            <p className="mt-1 text-sm leading-relaxed text-fg">{painPoint}</p>
          </div>
        </CardContent>
      </Card>

      {levers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {levers.map((lever) => (
            <StatCard key={lever.label} label={lever.label} value={lever.value} hint={lever.basis} />
          ))}
        </div>
      )}

      {contact && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-start gap-2.5">
              <AtSign className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <div className="text-[13px]">
                <p className="font-medium text-fg">{contact.email}</p>
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
