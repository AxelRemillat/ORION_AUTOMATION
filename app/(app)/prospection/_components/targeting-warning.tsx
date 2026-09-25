import { Building2 } from "lucide-react";

/**
 * Avertissement de ciblage du brief, en évidence : une filiale de grand
 * groupe décide rarement seule, et le mail risque de partir au mauvais étage.
 * Couleur « à traiter », jamais la couleur de marque.
 */
export function TargetingWarning({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border p-3"
      style={{ borderColor: "var(--warn)", background: "var(--warn-soft)" }}
    >
      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink" aria-hidden />
      <div className="text-[13px] leading-snug text-warn-ink">
        <p className="font-medium">Avertissement de ciblage</p>
        <p>{message}</p>
      </div>
    </div>
  );
}
