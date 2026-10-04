import type { Readiness } from "@/lib/usage/readiness";

/** Mails prêts / jour et coût par mail prêt (30 jours), sous les crédits du Pilotage. */

const eur = (value: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);

export function ReadinessTiles({ readiness, target }: { readiness: Readiness; target: number | null }) {
  const today = readiness.today;
  const tiles = [
    {
      label: "Mails prêts / jour (30 j)",
      value: readiness.readyPerDay.toLocaleString("fr-FR"),
      hint: `${readiness.totalReady} brouillon(s) noté(s) ≥ 9${target ? ` · objectif ${target}/jour` : ""}`,
    },
    {
      label: "Coût par mail prêt (30 j)",
      value: readiness.costPerReady === null ? "—" : eur(readiness.costPerReady),
      hint: "dépense totale ÷ mails prêts",
    },
    {
      label: "Aujourd'hui",
      value: today ? `${today.ready} prêt(s)` : "—",
      hint: today?.costPerReady != null ? `${eur(today.costPerReady)} par mail prêt` : today ? `${eur(today.eur)} dépensés` : "",
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line p-3">
          <span className="text-[12px] text-muted">{tile.label}</span>
          <span className="font-data text-[20px] text-text">{tile.value}</span>
          <span className="text-[11px] text-faint">{tile.hint}</span>
        </div>
      ))}
    </div>
  );
}
