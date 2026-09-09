import { cn } from "@/lib/utils";

/** Placeholder de chargement. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}
