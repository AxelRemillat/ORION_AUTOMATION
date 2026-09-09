import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { DEAL_STATUS_META, PROSPECT_STATUS_META } from "@/lib/constants";
import type { DealStatus, ProspectStatus } from "@/types";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

/**
 * Les tons semantiques (success / warning / danger) restent distincts de la
 * couleur de marque (accent / info), pour qu'un statut ne se confonde jamais
 * avec une action.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-primary/10 text-primary-ink border-primary/25",
  success: "bg-good/10 text-good-ink border-good/25",
  warning: "bg-warn/15 text-warn-ink border-warn/30",
  danger: "bg-lost/10 text-lost-ink border-lost/25",
  info: "bg-cyan/10 text-cyan-ink border-cyan/25",
};

const BASE =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-4";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return <span className={cn(BASE, TONES[tone], className)} {...props} />;
}

/** Badge du statut d'un prospect — couleur et libelle pilotes par lib/constants. */
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
