import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui";
import type { EnrichmentWarning } from "@/lib/enrichment/types";

/** Erreur bloquante d'une recherche (critères invalides, source injoignable). */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <Card className="border-danger/30 bg-danger/5">
      <CardContent className="flex items-start gap-2.5 p-4 text-[13px] text-fg">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        {message}
      </CardContent>
    </Card>
  );
}

/**
 * Sources indisponibles (clé manquante, API en panne) : informatif.
 * Les résultats restent affichés avec les données effectivement récupérées.
 */
export function WarningBanner({ warnings }: { warnings: EnrichmentWarning[] }) {
  if (!warnings.length) return null;

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardContent className="flex items-start gap-2.5 p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="text-[13px] text-fg">
          <p className="font-medium">Enrichissement partiel</p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {warnings.map((warning) => (
              <li key={`${warning.source}-${warning.message}`}>
                <span className="uppercase tracking-wide">{warning.source}</span> — {warning.message}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
