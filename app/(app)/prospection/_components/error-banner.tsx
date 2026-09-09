import { TriangleAlert } from "lucide-react";

/**
 * Bandeau d'erreur local à la Prospection (l'écran ne dépend ainsi d'aucun
 * composant d'une autre section). Couleur sémantique « perdu », jamais la
 * couleur de marque : une erreur ne doit pas ressembler à une action.
 */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border p-3"
      style={{ borderColor: "var(--lost)", background: "var(--lost-soft)" }}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-lost-ink" aria-hidden />
      <p className="text-[13px] leading-snug text-lost-ink">{message}</p>
    </div>
  );
}
