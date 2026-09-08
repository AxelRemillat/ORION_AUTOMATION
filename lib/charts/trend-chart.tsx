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
import type { TimePoint } from "./aggregate";
import { axisProps, useChartPalette } from "./palette";
import { ChartTooltip } from "./tooltip";

/**
 * Prospects contactés dans le temps : barres = par jour, courbe = cumul.
 * Un point tous les jours, même sans activité, pour garder une échelle lisible.
 */
export function TrendChart({ data, height = 260 }: { data: TimePoint[]; height?: number }) {
  const palette = useChartPalette();
  const axis = axisProps(palette);

  if (!data.some((point) => point.count > 0)) {
    return (
      <EmptyState
        title="Aucun message envoyé sur la période"
        description="La courbe se remplira dès le premier envoi depuis la page Suivi."
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke={palette.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axis} minTickGap={24} />
        <YAxis {...axis} allowDecimals={false} width={40} />
        <YAxis yAxisId="cumul" orientation="right" {...axis} allowDecimals={false} width={36} />
        <Tooltip
          cursor={{ fill: palette.muted, fillOpacity: 0.08 }}
          content={<ChartTooltip />}
        />
        <Bar dataKey="count" name="Contactés" fill={palette.accent} radius={[3, 3, 0, 0]} />
        <Line
          yAxisId="cumul"
          type="monotone"
          dataKey="cumulative"
          name="Cumul"
          stroke={palette.info}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
