import { Check, Clock, Mail, PenLine, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import type { SequenceStep, StepState } from "../_lib/sequence";

const STATE_META: Record<
  StepState,
  { icon: typeof Mail; token: string; label: string; filled: boolean }
> = {
  sent: { icon: Check, token: "var(--good)", label: "envoyé", filled: true },
  draft: { icon: PenLine, token: "var(--warn)", label: "brouillon", filled: true },
  planned: { icon: Clock, token: "var(--primary)", label: "programmée", filled: true },
  todo: { icon: Mail, token: "var(--faint)", label: "à faire", filled: false },
  skipped: { icon: Minus, token: "var(--faint)", label: "sans objet", filled: false },
};

/**
 * Vue d'ensemble de la séquence d'approche. Écran de lecture : l'envoi et les
 * relances se déclenchent depuis le Suivi, cette carte dit seulement où en est
 * le prospect sélectionné.
 */
export function SequenceShell({ steps }: { steps: SequenceStep[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Séquence d&apos;approche</CardTitle>
        <CardDescription>
          Intro, deux relances espacées, puis clôture. Les envois partent depuis le Suivi ; les
          relances sont programmées automatiquement après chaque envoi.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ol className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          {steps.map((step, index) => {
            const meta = STATE_META[step.state];
            const Icon = meta.icon;
            return (
              <li key={step.key} className="flex flex-1 items-center gap-3">
                <div
                  className="flex-1 rounded-lg border p-3"
                  style={{
                    borderColor: meta.filled ? meta.token : "var(--line)",
                    background: meta.filled ? "var(--surface-2)" : "transparent",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={{ background: meta.filled ? meta.token : "var(--line)" }}
                    >
                      <Icon className="h-3 w-3 text-surface" aria-hidden />
                    </span>
                    <span className="text-[13px] font-medium text-text">{step.label}</span>
                  </div>

                  <p className="mt-1.5 text-[12px] leading-snug text-faint">{step.hint}</p>
                  <p className="font-data mt-1 text-[11px]" style={{ color: meta.token }}>
                    {meta.label}
                    {step.at ? ` · ${formatDate(step.at)}` : ""}
                  </p>
                </div>

                {/* Connecteur : le dégradé de marque relie les étapes. */}
                {index < steps.length - 1 && (
                  <span
                    className="hidden h-px w-4 shrink-0 sm:block"
                    style={{ backgroundImage: "var(--accent-grad)" }}
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
