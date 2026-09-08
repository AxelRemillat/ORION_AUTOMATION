/**
 * Boîte à outils graphes (section Dashboard).
 * Les agrégats sont purs et calculés côté serveur ; les composants sont clients.
 */
export {
  contactedOverTime,
  funnelStats,
  revenueByMonth,
  totalRevenue,
  countByStatus,
  type TimePoint,
  type FunnelStats,
  type RevenuePoint,
} from "./aggregate";
export { TrendChart } from "./trend-chart";
export { RateChart } from "./rate-chart";
export { RevenueChart } from "./revenue-chart";
export { PipelineChart } from "./pipeline-chart";
export { ChartTooltip } from "./tooltip";
export { useChartPalette, axisProps, type ChartPalette } from "./palette";
