import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type DivProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        "relative rounded-xl border border-line bg-surface shadow-mist",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-display text-[15px] font-semibold tracking-tight text-text", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[13px] leading-relaxed text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("flex items-center gap-2 border-t border-line-soft px-5 py-3", className)}
      {...props}
    />
  );
}

/** Tuile de statistique : libelle, valeur, et precision optionnelle. */
export function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden p-5", className)}>
      {/* Filet degrade en tete de tuile : rappel discret de la marque. */}
      <span className="absolute inset-x-0 top-0 h-px bg-brand-grad" aria-hidden />
      <p className="font-data text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-2 font-display text-[26px] font-semibold leading-none tracking-tight text-text">
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-faint">{hint}</p>}
    </Card>
  );
}
