import type { FunnelCard } from "./view";

/**
 * Registre du creusage, pour le bandeau du run : combien de fiches lues par
 * Pappers ou par le repli gratuit (Recherche d'entreprises + INPI), combien
 * publiées « opposition non vérifiée », et les crédits Pappers restants.
 * Code pur : importé par le bandeau (client) et par `latest.ts` (serveur).
 */

export interface RegistryUsage {
  pappers: number;
  gratuit: number;
  /** Fiches publiées sans opposition vérifiée (programmation bloquée). */
  unverified: number;
  /** Crédits Pappers restants ce mois (`/suivi-jetons`), `null` si inconnus. */
  pappersCredits: number | null;
}

/** Comptes par registre des cartes creusées : code pur, testé. */
export function registryUsage(cards: readonly FunnelCard[], credits: number | null): RegistryUsage {
  const dug = cards.filter((card) => card.statut === "creusé");
  return {
    pappers: dug.filter((card) => card.registry !== "gratuit").length,
    gratuit: dug.filter((card) => card.registry === "gratuit").length,
    unverified: dug.filter((card) => card.oppositionUnverified).length,
    pappersCredits: credits,
  };
}

/** « Pappers », « gratuit (Pappers épuisé) » ou « Pappers 4 · gratuit 3 ». */
export function registryLabel(registry: RegistryUsage): string {
  if (registry.pappers + registry.gratuit === 0) return "aucune fiche creusée";
  if (registry.gratuit === 0) return "Pappers";
  if (registry.pappers === 0) return "gratuit (Recherche d'entreprises + INPI)";
  return `Pappers ${registry.pappers} · gratuit ${registry.gratuit}`;
}
