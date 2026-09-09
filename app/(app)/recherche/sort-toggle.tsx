"use client";

export type SortMode = "chaleur" | "pertinence";

const OPTIONS: { value: SortMode; label: string; hint: string }[] = [
  { value: "chaleur", label: "Chaleur", hint: "Les signaux les plus forts d'abord" },
  { value: "pertinence", label: "Pertinence", hint: "Ordre de l'annuaire des entreprises" },
];

/** Bascule d'ordre des résultats. L'onglet actif est souligné par --accent-grad. */
export function SortToggle({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (mode: SortMode) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Trier les résultats">
      {OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className="relative rounded px-2.5 py-1 text-[13px] font-medium motion-safe:transition-colors"
            style={{ color: active ? "var(--text)" : "var(--muted)" }}
          >
            {option.label}
            {active && (
              <span
                aria-hidden
                className="bg-brand-grad absolute inset-x-1.5 -bottom-0.5 h-0.5 rounded-full"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
