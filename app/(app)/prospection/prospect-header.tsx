"use client";

import { MapPin, RefreshCw, Sparkles, Users } from "lucide-react";
import { Badge, Button, Card, CardContent, ProspectStatusBadge } from "@/components/ui";
import { formatEur } from "@/lib/utils";
import type { Prospect } from "@/types";
import { offTargetReason } from "@/lib/funnel/off-target";
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
  onReanalyze,
  reanalyzing = false,
}: {
  prospect: Prospect;
  loading: boolean;
  hasAnalysis: boolean;
  tone: ToneKey;
  onToneChange: (tone: ToneKey) => void;
  onGenerate: () => void;
  /**
   * Ré-enrichissement de la FICHE — distinct de la génération du mail.
   *
   * « Relancer l'analyse » ne relance que la rédaction : les données de la fiche
   * ne bougent pas. Une fiche ouverte avant une amélioration de
   * l'enrichissement restait donc dans son ancien état, sans aucun moyen de la
   * rafraîchir depuis l'écran.
   */
  onReanalyze?: () => void;
  reanalyzing?: boolean;
}) {
  const revenue = prospect.key_figures?.revenue_eur;
  const offTarget = offTargetReason(prospect);
  // Un prospect perdu a deja dit non : relancer la generation, c'est payer des
  // credits pour ecrire a quelqu'un qu'on ne recontactera pas.
  const closed = prospect.status === "perdu";

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
            {/*
              Deux badges, un seul à la fois :
              - « opposé à la prospection » quand l'entreprise s'est opposée à
                l'usage commercial de ses données au registre (INPI/RNE, lu via
                Pappers) — le motif le plus précis, et le plus contraignant ;
              - « hors cible » pour les autres motifs de l'entonnoir (aucun
                salarié, capitaux propres sous le seuil d'alerte, commerce de
                détail sous 20 salariés), appliqués aux fiches déjà ouvertes.
              Dans les deux cas l'envoi est désactivé, et le motif est écrit
              sous le nom.
            */}
            {prospect.key_figures?.refuses_prospecting === true ? (
              <Badge tone="danger">opposé à la prospection</Badge>
            ) : (
              offTarget && <Badge tone="danger">hors cible</Badge>
            )}
          </div>

          {offTarget && (
            <p className="mt-1.5 text-[13px] text-lost-ink">
              Hors cible : {offTarget}. L&apos;envoi est désactivé.
            </p>
          )}

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

        <div className="flex flex-col items-end gap-1.5">
          <Button
            onClick={onGenerate}
            loading={loading}
            disabled={closed}
            variant={hasAnalysis ? "secondary" : "primary"}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {hasAnalysis ? "Régénérer le mail" : "Analyser et générer l'email"}
          </Button>
          {onReanalyze && (
            <Button variant="ghost" size="sm" onClick={onReanalyze} loading={reanalyzing} disabled={loading}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              Ré-enrichir la fiche
            </Button>
          )}
          {closed && (
            <p className="text-[12px] text-muted">
              Prospect clôturé : passez-le hors de « Perdu » pour générer un email.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
