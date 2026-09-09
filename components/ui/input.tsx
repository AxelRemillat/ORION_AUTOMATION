import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Styles partages par Input, Textarea et Select pour un rendu homogene. */
export const fieldClassName = cn(
  "w-full rounded-lg border border-line bg-surface px-3 text-sm text-text",
  "placeholder:text-faint",
  "transition-colors hover:border-line focus:border-primary",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Message d'erreur : colore le champ et est annonce aux lecteurs d'ecran. */
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
        className={cn(fieldClassName, "h-10", error && "border-lost", className)}
        {...props}
      />
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-lost">
          {error}
        </p>
      )}
    </div>
  );
});

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-muted font-data",
        className,
      )}
      {...props}
    />
  );
}
