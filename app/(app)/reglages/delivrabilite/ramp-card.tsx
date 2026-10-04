import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import type { RampCondition } from "@/lib/settings/ramp";

/** Prochaine marche de volume et ses conditions (affichage, la montée automatique ne change pas). */
export function RampCard({ current, target, ready, conditions }: { current: number; target: number; ready: boolean; conditions: RampCondition[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Prochaine marche : {target} envois par jour</CardTitle>
        <CardDescription>
          Aujourd&apos;hui : {current} par jour. Passer à {target} n&apos;est raisonnable que si la réputation de l&apos;adresse tient.{" "}
          {ready ? <span className="text-good-ink">Conditions réunies.</span> : <span className="text-warn-ink">Conditions pas encore réunies.</span>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {conditions.map((condition) => (
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
        <p className="mt-3 text-[11px] text-faint">La montée en charge automatique (plafond appliqué par le serveur) reste inchangée.</p>
      </CardContent>
    </Card>
  );
}
