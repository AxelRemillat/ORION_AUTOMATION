import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui";
import type { EnrichmentWarning } from "@/lib/enrichment/types";

/** Erreur bloquante d'une recherche (critères invalides, source injoignable). */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <Card className="border-lost/30 bg-lost/5">
      <CardContent className="flex items-start gap-2.5 p-4 text-[13px] text-text">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-lost" aria-hidden />
        {message}
      </CardContent>
    </Card>
  );
}

/**
 * Un site écarté parce qu'il ne nomme pas l'entreprise est le fonctionnement
 * NORMAL de l'ancrage : c'est lui qui empêche d'attribuer à une société les
 * actualités d'une homonyme. Le compter comme un incident noyait les vraies
 * pannes sous une liste de lignes rassurantes.
 */
export function isAnchoringRejection(warning: EnrichmentWarning): boolean {
  return /écarté|ecarte|ne mentionne ni le nom|robots\.txt|injoignable/i.test(warning.message);
}

/**
 * Sources indisponibles (clé manquante, API en panne) : informatif.
 * Les résultats restent affichés avec les données effectivement récupérées.
 */
export function WarningBanner({ warnings }: { warnings: EnrichmentWarning[] }) {
  if (!warnings.length) return null;

  const rejected = warnings.filter(isAnchoringRejection);
  const failures = warnings.filter((warning) => !isAnchoringRejection(warning));

  // Que des rejets d'ancrage : rien d'anormal, on n'alerte pas.
  if (!failures.length) {
    return (
      <details className="rounded-xl border border-line-soft bg-surface px-4 py-2.5">
        <summary className="cursor-pointer text-[13px] text-muted">
          {rejected.length} source{rejected.length > 1 ? "s" : ""} écartée
          {rejected.length > 1 ? "s" : ""} — elles ne nommaient pas l&apos;entreprise
        </summary>
        <ul className="mt-2 space-y-0.5 text-[12px] text-faint">
          {rejected.map((warning) => (
            <li key={`${warning.source}-${warning.message}`}>
              <span className="uppercase tracking-wide">{warning.source}</span> — {warning.message}
            </li>
          ))}
        </ul>
      </details>
    );
  }

  return (
    <Card className="border-warn/30 bg-warn/5">
      <CardContent className="flex items-start gap-2.5 p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
        <div className="w-full text-[13px] text-text">
          <p className="font-medium">Enrichissement partiel</p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {failures.map((warning) => (
              <li key={`${warning.source}-${warning.message}`}>
                <span className="uppercase tracking-wide">{warning.source}</span> — {warning.message}
              </li>
            ))}
          </ul>

          {rejected.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] text-muted">
                {rejected.length} source{rejected.length > 1 ? "s" : ""} écartée
                {rejected.length > 1 ? "s" : ""} (normal)
              </summary>
              <ul className="mt-1 space-y-0.5 text-[12px] text-faint">
                {rejected.map((warning) => (
                  <li key={`${warning.source}-${warning.message}`}>
                    <span className="uppercase tracking-wide">{warning.source}</span> — {warning.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
