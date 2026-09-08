import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Styles partagés par Input, Textarea et Select pour un rendu homogène. */
export const fieldClassName = cn(
  "w-full rounded border border-border bg-surface-2 px-3 text-sm text-fg",
  "placeholder:text-muted/70",
  "transition-colors focus:border-accent/60",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Message d'erreur : colore le champ et est annoncé aux lecteurs d'écran. */
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error, ...props },
  ref,
) {
  return (
    <div className="w-full">
      <input
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={cn(fieldClassName, "h-9", error && "border-danger", className)}
        {...props}
      />
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
});

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[13px] font-medium text-muted", className)}
      {...props}
    />
  );
}
