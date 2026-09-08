"use client";

import { useEffect, useState } from "react";

/**
 * Recharts a besoin de couleurs concrètes (attributs SVG) alors que le design
 * system vit dans des variables CSS. On lit donc les tokens sur <html> et on
 * les relit à chaque bascule de thème (le ThemeToggle change la classe).
 */

const TOKENS = [
  "accent",
  "success",
  "info",
  "violet",
  "teal",
  "warning",
  "danger",
  "muted",
  "border",
  "surface",
  "fg",
] as const;

export type ChartToken = (typeof TOKENS)[number];
export type ChartPalette = Record<ChartToken, string>;

/** Palette de repli (thème sombre) : utilisée au rendu serveur, avant hydratation. */
const FALLBACK: ChartPalette = {
  accent: "rgb(232 85 46)",
  success: "rgb(52 199 123)",
  info: "rgb(96 165 250)",
  violet: "rgb(167 139 250)",
  teal: "rgb(45 212 191)",
  warning: "rgb(234 179 8)",
  danger: "rgb(244 88 88)",
  muted: "rgb(139 146 160)",
  border: "rgb(38 42 50)",
  surface: "rgb(19 21 25)",
  fg: "rgb(232 234 239)",
};

function readPalette(): ChartPalette {
  const styles = getComputedStyle(document.documentElement);
  const entries = TOKENS.map((token) => {
    const raw = styles.getPropertyValue(`--${token}`).trim();
    return [token, raw ? `rgb(${raw})` : FALLBACK[token]] as const;
  });
  return Object.fromEntries(entries) as ChartPalette;
}

export function useChartPalette(): ChartPalette {
  const [palette, setPalette] = useState<ChartPalette>(FALLBACK);

  useEffect(() => {
    const sync = () => setPalette(readPalette());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return palette;
}

/** Props d'axes communes à tous les graphes (typographie discrète, pas de ligne). */
export function axisProps(palette: ChartPalette) {
  return {
    stroke: palette.muted,
    tickLine: false,
    axisLine: false,
    tick: { fill: palette.muted, fontSize: 11 },
  } as const;
}
