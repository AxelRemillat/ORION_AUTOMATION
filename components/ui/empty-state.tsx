import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Etat vide generique : icone, titre, explication, action facultative. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface/60 px-6 py-16 text-center",
        className,
      )}
    >
      {icon && <div className="mb-3 text-faint [&>svg]:h-8 [&>svg]:w-8">{icon}</div>}
      <h3 className="font-display text-[15px] font-semibold text-text">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
