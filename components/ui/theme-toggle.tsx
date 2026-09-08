"use client";

import { useCallback } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Bascule sombre / clair. Les deux icônes sont rendues et affichées par CSS
 * (variante `dark:`) : aucun état React, donc aucun décalage d'hydratation.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const toggle = useCallback(() => {
    const root = document.documentElement;
    const next = root.classList.contains("light") ? "dark" : "light";
    root.classList.remove("light", "dark");
    root.classList.add(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Stockage indisponible (navigation privée) : le thème reste valable
      // pour la session en cours, on n'échoue pas pour autant.
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Changer de thème"
      title="Changer de thème"
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded text-muted",
        "transition-colors hover:bg-surface-2 hover:text-fg",
        className,
      )}
    >
      <Sun className="hidden h-4 w-4 dark:block" aria-hidden />
      <Moon className="block h-4 w-4 dark:hidden" aria-hidden />
    </button>
  );
}
