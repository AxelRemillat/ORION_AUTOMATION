"use client";

import { MapPin, Sparkles, Users } from "lucide-react";
import { Badge, Button, Card, CardContent, ProspectStatusBadge } from "@/components/ui";
import { formatEur } from "@/lib/utils";
import type { Prospect } from "@/types";
import { ToneSelector } from "./_components/tone-selector";
import type { ToneKey } from "./_lib/tones";

/** Rappel du prospect sélectionné, choix du ton, déclencheur de l'analyse IA. */
export function ProspectHeader({
  prospect,
  loading,
  hasAnalysis,
  tone,
  onToneChange,
  onGenerate,
}: {
  prospect: Prospect;
  loading: boolean;
  hasAnalysis: boolean;
  tone: ToneKey;
  onToneChange: (tone: ToneKey) => void;
  onGenerate: () => void;
}) {
  const revenue = prospect.key_figures?.revenue_eur;

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-halo" aria-hidden />

      <CardContent className="relative flex flex-wrap items-start justify-between gap-5 p-5">
        <div className="min-w-[260px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[17px] font-semibold tracking-tight text-text">
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

          <div className="mt-4">
            <ToneSelector value={tone} onChange={onToneChange} disabled={loading} />
          </div>
        </div>

        <Button
          onClick={onGenerate}
          loading={loading}
          variant={hasAnalysis ? "secondary" : "primary"}
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {hasAnalysis ? "Relancer l'analyse" : "Analyser et générer l'email"}
        </Button>
      </CardContent>
    </Card>
  );
}
