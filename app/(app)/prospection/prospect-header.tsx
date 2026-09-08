"use client";

import { MapPin, Sparkles, Users } from "lucide-react";
import { Badge, Button, Card, CardContent, ProspectStatusBadge } from "@/components/ui";
import { formatEur } from "@/lib/utils";
import type { Prospect } from "@/types";

/** Rappel du prospect sélectionné + déclencheur de l'analyse IA. */
export function ProspectHeader({
  prospect,
  loading,
  hasAnalysis,
  onGenerate,
}: {
  prospect: Prospect;
  loading: boolean;
  hasAnalysis: boolean;
  onGenerate: () => void;
}) {
  const revenue = prospect.key_figures?.revenue_eur;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight text-fg">
              {prospect.company_name}
            </h2>
            <ProspectStatusBadge status={prospect.status} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {prospect.sector && <Badge tone="accent">{prospect.sector}</Badge>}
            {prospect.size_range && (
              <Badge>
                <Users className="h-3 w-3" aria-hidden />
                {prospect.size_range}
              </Badge>
            )}
            {prospect.city && (
              <Badge>
                <MapPin className="h-3 w-3" aria-hidden />
                {prospect.city}
              </Badge>
            )}
            {typeof revenue === "number" && <Badge>CA {formatEur(revenue)}</Badge>}
          </div>

          <p className="mt-2 text-[13px] text-muted">
            {prospect.signals?.length
              ? `${prospect.signals.length} signal(aux) disponible(s) pour personnaliser l'accroche.`
              : "Aucun signal enregistré : l'analyse s'appuiera sur les données structurelles."}
          </p>
        </div>

        <Button onClick={onGenerate} loading={loading}>
          <Sparkles className="h-4 w-4" aria-hidden />
          {hasAnalysis ? "Relancer l'analyse" : "Analyser et générer l'email"}
        </Button>
      </CardContent>
    </Card>
  );
}
