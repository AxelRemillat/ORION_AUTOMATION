"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui";
import { formatEur } from "@/lib/utils";
import type { RevenuePoint } from "./aggregate";
import { axisProps, useChartPalette } from "./palette";
import { ChartTooltip } from "./tooltip";

/** Chiffre d'affaires signé par mois (barres) et nombre de contrats (courbe). */
export function RevenueChart({ data, height = 260 }: { data: RevenuePoint[]; height?: number }) {
  const palette = useChartPalette();
  const axis = axisProps(palette);

  if (!data.some((point) => point.deals > 0)) {
    return (
      <EmptyState
        title="Aucun contrat signé pour l'instant"
        description="Passez un prospect en « Gagné » depuis le Suivi pour enregistrer un deal."
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={palette.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis
          {...axis}
          width={64}
          tickFormatter={(value: number) => (value >= 1000 ? `${value / 1000}k€` : `${value}€`)}
        />
        <YAxis yAxisId="count" orientation="right" {...axis} allowDecimals={false} width={32} />
        <Tooltip
          cursor={{ fill: palette.muted, fillOpacity: 0.08 }}
          content={
            <ChartTooltip
              format={(value, dataKey) => (dataKey === "amount" ? formatEur(value) : String(value))}
            />
          }
        />
        <Bar dataKey="amount" name="CA signé" fill={palette.accent} radius={[3, 3, 0, 0]} />
        <Line
          yAxisId="count"
          type="monotone"
          dataKey="deals"
          name="Contrats"
          stroke={palette.success}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
