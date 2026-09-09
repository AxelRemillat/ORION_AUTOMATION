import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Sparkline } from "../_charts/sparkline";

/**
 * Tuile de KPI : valeur en chasse fixe, contexte en dessous, et mini-graphe
 * optionnel en pied de carte. Le halo de marque n'est posé que sur la tuile
 * mise en avant, pour garder la rangée calme.
 */
export function KpiTile({
  label,
  value,
  hint,
  series,
  seriesId,
  seriesLabel,
  tone = "brand",
  featured = false,
  badge,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Série du mini-graphe (optionnelle). */
  series?: number[];
  seriesId?: string;
  seriesLabel?: string;
  tone?: "brand" | "good" | "warn";
  featured?: boolean;
  badge?: ReactNode;
}) {
  const token = tone === "good" ? "--good" : tone === "warn" ? "--warn" : "--primary";

  return (
    <Card
      className={cn(
        "relative overflow-hidden p-5",
        featured && "before:absolute before:inset-x-0 before:top-0 before:h-24 before:bg-halo",
      )}
    >
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        {badge}
      </div>

      <p className="font-data relative mt-2 text-[27px] font-semibold leading-none text-text">
        {value}
      </p>
      {hint && <p className="relative mt-1.5 text-xs leading-snug text-faint">{hint}</p>}

      {series && series.length > 0 && seriesId && (
        <div className="relative mt-4">
          <Sparkline
            values={series}
            id={seriesId}
            label={seriesLabel ?? label}
            token={token}
          />
        </div>
      )}
    </Card>
  );
}
