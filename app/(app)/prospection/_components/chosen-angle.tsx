"use client";

import { useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import type { DeepAnalysis } from "@/app/api/emails/generate/analysis";

/**
 * « Angle choisi » — repliable.
 *
 * Deux usages : vérifier d'un coup d'œil sur quoi le mail s'appuie (un
 * diagnostic faux se repère ici bien plus vite qu'en relisant le mail), et
 * basculer sur un autre angle. Ce second bouton ne rejoue QUE la rédaction :
 * l'analyse est renvoyée telle quelle au serveur, donc zéro appel Linkup,
 * Pappers ou Hunter.
 */
export function ChosenAngle({
  analysis,
  regenerating,
  onOtherAngle,
}: {
  analysis: DeepAnalysis;
  regenerating: boolean;
  /** Rejoue la rédaction avec l'angle suivant. */
  onOtherAngle: (nextIndex: number) => void;
}) {
  const [open, setOpen] = useState(true);

  const hookIndex = analysis.chosen.hookIndex;
  const painIndex = analysis.chosen.painIndex;
  const hook = analysis.hookCandidates[hookIndex];
  const pain = analysis.painCandidates[painIndex];

  const otherHooks = analysis.hookCandidates
    .map((candidate, index) => ({ candidate, index }))
    .filter((entry) => entry.index !== hookIndex);

  return (
    <div className="rounded-xl border border-line bg-surface shadow-mist">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <span className="font-data text-[11px] font-medium uppercase tracking-wide text-muted">
          Angle choisi
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-line-soft px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium text-muted">Accroche retenue</span>
              <Badge tone="accent">{hook?.type ?? "observation"}</Badge>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text">{hook?.text}</p>
          </div>

          <div>
            <span className="text-[12px] font-medium text-muted">Pain retenu</span>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text">{pain?.task}</p>
            {pain && (
              <p className="mt-1 text-[12px] leading-relaxed text-faint">
                {pain.whoSuffers} · {pain.whyHere} · spécificité {pain.specificity}/5
              </p>
            )}
          </div>

          {otherHooks.length > 0 && (
            <div>
              <p className="mb-2 text-[12px] font-medium text-muted">
                Alternatives — régénère uniquement la rédaction, sans nouvel appel API
              </p>
              <ul className="flex flex-col gap-2">
                {otherHooks.map(({ candidate, index }) => (
                  <li
                    key={candidate.text}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-soft bg-surface-2 px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <Badge tone="neutral">{candidate.type}</Badge>
                      <p className="mt-1 text-[13px] leading-relaxed text-text">{candidate.text}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={regenerating}
                      onClick={() => onOtherAngle(index)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                      Autre angle
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
