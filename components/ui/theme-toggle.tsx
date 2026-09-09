"use client";

import { useCallback } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyTheme, currentTheme } from "@/lib/theme";

/**
 * Bascule clair / sombre.
 *
 * Les deux icones sont rendues et l'affichage est pilote par CSS (classes
 * `theme-icon-*` dans globals.css, qui suivent data-theme et la preference
 * systeme) : aucun etat React, donc aucun decalage d'hydratation.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const toggle = useCallback(() => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Changer de theme"
      title="Changer de theme"
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted",
        "transition-colors hover:bg-surface-2 hover:text-text",
        className,
      )}
    >
      <Sun className="theme-icon-dark h-4 w-4" aria-hidden />
      <Moon className="theme-icon-light h-4 w-4" aria-hidden />
    </button>
  );
}
