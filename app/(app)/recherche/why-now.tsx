import { Clock } from "lucide-react";
import type { WhyNow as WhyNowData } from "@/lib/scoring";
import { ExampleTag } from "./signal-chip";

/**
 * « Pourquoi maintenant » — l'argument d'urgence, dérivé du signal le plus fort.
 * Règle déterministe pour l'instant (lib/scoring), une génération IA pourra la
 * remplacer sans toucher à cet affichage.
 */
export function WhyNowCard({ why }: { why: WhyNowData | null }) {
  if (!why) {
    return (
      <p className="text-[13px]" style={{ color: "var(--faint)" }}>
        Aucun signal détecté : l&apos;accroche devra venir d&apos;ailleurs.
      </p>
    );
  }

  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: "var(--line-soft)", background: "var(--surface-2)" }}
    >
      <div className="flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" aria-hidden style={{ color: "var(--primary)" }} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary-ink">
          Pourquoi maintenant
        </span>
        {!why.real && <ExampleTag label="déduit" />}
      </div>

      <p className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--text)" }}>
        {why.headline}
      </p>

      <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--muted)" }}>
        {why.evidence}
        {why.url && (
          <>
            {" · "}
            <a
              href={why.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-dotted underline-offset-2"
            >
              source
            </a>
          </>
        )}
      </p>
    </div>
  );
}
