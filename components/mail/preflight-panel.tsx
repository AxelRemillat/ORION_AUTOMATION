"use client";

import { AlertTriangle, CheckCircle2, Loader2, Wand2, XCircle } from "lucide-react";
import { Button } from "@/components/ui";
import type { FixId, PreflightResult } from "@/lib/mail-preflight";

/**
 * Panneau « Contrôle avant envoi » : ✅ / ⚠️ / ❌ par règle, et la correction
 * en un clic quand elle existe. Une erreur bloque la validation, la
 * programmation et le départ ; un avertissement s'affiche seulement.
 */
const ICON = {
  ok: <CheckCircle2 className="h-4 w-4 text-good-ink" aria-label="conforme" />,
  warning: <AlertTriangle className="h-4 w-4 text-warn-ink" aria-label="avertissement" />,
  error: <XCircle className="h-4 w-4 text-lost-ink" aria-label="bloquant" />,
};

export function PreflightPanel({
  result,
  loading,
  onFix,
}: {
  result: PreflightResult | null;
  loading?: boolean;
  onFix?: (fix: FixId) => void;
}) {
  return (
    <section className="rounded-md border border-line-soft bg-surface-2/60 p-3" aria-live="polite">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-text">Contrôle avant envoi</h3>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-faint motion-reduce:animate-none" aria-label="vérification" />
        ) : result ? (
          <span className={`font-data text-[12px] ${result.ok ? "text-good-ink" : "text-lost-ink"}`}>
            {result.ok ? "prêt à partir" : `${result.errors.length} bloquant${result.errors.length > 1 ? "s" : ""}`}
          </span>
        ) : null}
      </header>
      {!result ? (
        <p className="text-[12px] text-faint">Vérification en cours…</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {result.checks.map((check) => (
            <li key={check.rule} className="flex flex-wrap items-center gap-2 text-[12px]">
              {ICON[check.status]}
              <span className={check.status === "ok" ? "text-muted" : "text-text"}>{check.message ?? check.label}</span>
              {check.fix && onFix && (
                <Button size="sm" variant="ghost" onClick={() => onFix(check.fix as FixId)}>
                  <Wand2 className="h-3.5 w-3.5" aria-hidden />
                  {result.fixes.find((fix) => fix.id === check.fix)?.label ?? "Corriger"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
