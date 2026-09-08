import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { DEAL_STATUS_META, PROSPECT_STATUS_META } from "@/lib/constants";
import type { DealStatus, ProspectStatus } from "@/types";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-muted/15 text-muted border-muted/25",
  accent: "bg-accent/15 text-accent border-accent/30",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-danger/15 text-danger border-danger/30",
  info: "bg-info/15 text-info border-info/30",
};

const BASE =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return <span className={cn(BASE, TONES[tone], className)} {...props} />;
}

/** Badge du statut d'un prospect — couleur et libellé pilotés par lib/constants. */
export function ProspectStatusBadge({
  status,
  className,
}: {
  status: ProspectStatus;
  className?: string;
}) {
  const meta = PROSPECT_STATUS_META[status];
  return <span className={cn(BASE, meta.className, className)}>{meta.label}</span>;
}

/** Badge du statut d'un deal. */
export function DealStatusBadge({
  status,
  className,
}: {
  status: DealStatus;
  className?: string;
}) {
  const meta = DEAL_STATUS_META[status];
  return <span className={cn(BASE, meta.className, className)}>{meta.label}</span>;
}
