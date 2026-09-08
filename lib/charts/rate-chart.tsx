"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/ui";
import type { FunnelStats } from "./aggregate";
import { axisProps, useChartPalette } from "./palette";
import { ChartTooltip } from "./tooltip";

const asPercent = (value: number) => `${Math.round(value * 100)} %`;

/**
 * Taux de relance, de réponse et de succès, en barres horizontales.
 * Chaque barre porte son dénominateur en info-bulle pour éviter les
 * pourcentages trompeurs sur de petits volumes.
 */
export function RateChart({ stats, height = 220 }: { stats: FunnelStats; height?: number }) {
  const palette = useChartPalette();
  const axis = axisProps(palette);

  const data = [
    { label: "Relance", value: stats.relanceRate, base: stats.contacted, color: palette.warning },
    { label: "Réponse", value: stats.replyRate, base: stats.contacted, color: palette.info },
    { label: "Succès", value: stats.successRate, base: stats.replied, color: palette.success },
  ];

  if (stats.contacted === 0) {
    return (
      <EmptyState
        title="Pas encore de prospect contacté"
        description="Les taux se calculent dès qu'un premier message est parti."
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 8 }}>
        <XAxis type="number" domain={[0, 1]} hide />
        <YAxis type="category" dataKey="label" {...axis} width={72} />
        <Tooltip
          cursor={{ fill: palette.muted, fillOpacity: 0.08 }}
          content={<ChartTooltip format={asPercent} />}
        />
        <Bar dataKey="value" name="Taux" radius={[0, 4, 4, 0]} barSize={22}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={entry.color} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(value: number) => asPercent(value)}
            fill={palette.fg}
            fontSize={12}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
