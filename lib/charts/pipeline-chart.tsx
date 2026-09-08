"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/ui";
import { PROSPECT_STATUS_META } from "@/lib/constants";
import type { ProspectStatus } from "@/types";
import { axisProps, useChartPalette } from "./palette";
import { ChartTooltip } from "./tooltip";

/** Couleur de barre par statut, alignée sur les badges du design system. */
function statusColor(status: ProspectStatus, palette: ReturnType<typeof useChartPalette>) {
  const map: Record<ProspectStatus, string> = {
    nouveau: palette.muted,
    a_contacter: palette.accent,
    contacte: palette.info,
    relance_1: palette.warning,
    relance_2: palette.violet,
    repondu: palette.teal,
    en_discussion: palette.accent,
    gagne: palette.success,
    perdu: palette.danger,
  };
  return map[status];
}

/** Répartition des prospects par étape du pipeline. */
export function PipelineChart({
  data,
  height = 260,
}: {
  data: { status: ProspectStatus; count: number }[];
  height?: number;
}) {
  const palette = useChartPalette();
  const axis = axisProps(palette);

  if (!data.some((entry) => entry.count > 0)) {
    return (
      <EmptyState
        title="Pipeline vide"
        description="Importez ou recherchez des prospects pour voir la répartition par étape."
      />
    );
  }

  const chartData = data.map((entry) => ({
    ...entry,
    label: PROSPECT_STATUS_META[entry.status].label,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke={palette.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axis} interval={0} angle={-30} textAnchor="end" height={56} />
        <YAxis {...axis} allowDecimals={false} width={40} />
        <Tooltip
          cursor={{ fill: palette.muted, fillOpacity: 0.08 }}
          content={<ChartTooltip />}
        />
        <Bar dataKey="count" name="Prospects" radius={[3, 3, 0, 0]}>
          {chartData.map((entry) => (
            <Cell key={entry.status} fill={statusColor(entry.status, palette)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
