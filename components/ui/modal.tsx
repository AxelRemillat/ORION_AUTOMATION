"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: ReactNode;
  /** Zone d'actions en pied de modale (boutons). */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" } as const;

/**
 * Modale controlee : fermeture par Echap, clic sur le fond ou bouton croix.
 * Le defilement de la page est bloque tant qu'elle est ouverte.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-deep/40 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative w-full overflow-hidden rounded-2xl border border-line bg-elev shadow-overlay outline-none animate-slide-up",
          SIZES[size],
        )}
      >
        <span className="absolute inset-x-0 top-0 h-px bg-brand-grad" aria-hidden />
        {(title || description) && (
          <div className="border-b border-line-soft px-5 py-4 pr-12">
            {title && (
              <h2 className="font-display text-[16px] font-semibold text-text">{title}</h2>
            )}
            {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line-soft bg-surface-2/40 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
