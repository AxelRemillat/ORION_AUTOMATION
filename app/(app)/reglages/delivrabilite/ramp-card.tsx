import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import type { RampStep } from "@/lib/settings/ramp";

/** Plafond du jour, palier suivant et sa condition (Cowork #26 : 25 → 30 → 40 → 50, au-delà de 30 jamais automatique). */
export function RampCard({ step }: { step: RampStep }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Plafond du jour : {step.current} envois{step.target !== null ? ` · prochain palier : ${step.target}` : ""}
        </CardTitle>
        <CardDescription>
          {step.target === null ? step.how : `Passage à ${step.target} : ${step.how}.`}{" "}
          {step.target !== null && (step.ready ? <span className="text-good-ink">Conditions réunies.</span> : <span className="text-warn-ink">Conditions pas encore réunies.</span>)}
        </CardDescription>
      </CardHeader>
      {step.target !== null && (
        <CardContent>
          <ul className="flex flex-col gap-2">
            {step.conditions.map((condition) => (
              <li key={condition.label} className="flex items-start gap-2 text-[13px]">
                {condition.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" aria-label="remplie" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-label="pas encore" />
                )}
                <span className="min-w-0">
                  <span className="text-text">{condition.label}</span>
                  <span className="block text-[12px] text-faint">{condition.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-faint">Échelle : 25 → 30 (automatique) → 40 → 50 (maximum sur cette boîte, à débloquer à la main).</p>
        </CardContent>
      )}
    </Card>
  );
}
