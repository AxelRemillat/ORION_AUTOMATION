/**
 * Plafond lu en ligne de commande (Cowork #45). `Number("0") || 40` valait 40 :
 * un « --hunter-cap 0 » lançait un lot à 40 crédits. Ici, 0 reste 0 ; seule une
 * valeur absente ou illisible prend le défaut.
 */
export function capArg(raw: string | null | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}
