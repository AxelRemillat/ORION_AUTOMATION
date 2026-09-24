"use client";

import { ExternalLink, Lightbulb, RefreshCw, Target } from "lucide-react";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import type { DeepAnalysis } from "@/app/api/emails/generate/analysis";

/**
 * Ce sur quoi le mail s'appuie — et les pistes écartées.
 *
 * Deux raisons d'afficher ça sous le brouillon : vérifier que l'analyse a
 * compris le métier (un diagnostic faux se repère en une seconde ici, pas
 * en relisant le mail), et pouvoir basculer sur un autre process sans
 * relancer une recherche.
 */
export function AnalysisTracks({
  analysis,
  regenerating,
  onPickTrack,
}: {
  analysis: DeepAnalysis;
  regenerating: boolean;
  /** Rejoue la génération sur la piste choisie. */
  onPickTrack: (index: number) => void;
}) {
  const [retained, ...others] = analysis.tracks;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-data text-[11px] font-medium uppercase tracking-wide text-muted">
            Sur quoi ce mail s&apos;appuie
          </p>
          {!analysis.specific && (
            <Badge tone="warning">aucune donnée spécifique — diagnostic générique</Badge>
          )}
        </div>

        <p className="text-[13px] leading-relaxed text-muted">
          <span className="font-medium text-text">Leur métier : </span>
          {analysis.business_model}
        </p>

        {/* La piste retenue, avec sa preuve. */}
        <div className="rounded-xl border border-primary/25 bg-primary/10 p-4">
          <div className="flex items-start gap-2.5">
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text">{retained?.label ?? analysis.pain_point}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                <span className="font-medium">Pourquoi eux : </span>
                {analysis.pourquoi_lui}
                {analysis.proof_url && (
                  <>
                    {" "}
                    <a
                      href={analysis.proof_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-primary-ink underline decoration-dotted underline-offset-2"
                    >
                      source
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  </>
                )}
              </p>
              {analysis.detail_unique && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                  <span className="font-medium">Détail repris dans l&apos;accroche : </span>
                  {analysis.detail_unique}
                </p>
              )}
            </div>
          </div>
        </div>

        {others.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden />
              Pistes écartées — régénérez sur l&apos;une d&apos;elles si elle colle mieux
            </p>
            <ul className="flex flex-col gap-2">
              {others.map((track, position) => (
                <li
                  key={track.label}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-soft bg-surface-2 px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-text">{track.label}</p>
                    {track.why && <p className="text-[12px] text-muted">{track.why}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={regenerating}
                    // +1 : la piste retenue occupe l'index 0.
                    onClick={() => onPickTrack(position + 1)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    Générer sur cette piste
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
