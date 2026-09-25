/**
 * Ce que le client et le serveur partagent du mode « Signaux d'abord ».
 *
 * Volontairement séparé de `lib/signals/index.ts` : celui-ci atteint Supabase et
 * l'annuaire, donc `next/headers`, et l'importer depuis un composant `"use
 * client"` faisait échouer le build. Ici il n'y a que des constantes et des
 * formes — rien qui appelle quoi que ce soit.
 */

export type SignalSourceId = "bodacc" | "france-travail";

/** Ce que l'écran affiche pour chaque source, y compris indisponible. */
export interface SignalSourceState {
  id: SignalSourceId;
  label: string;
  available: boolean;
  /** Pourquoi la source est hors jeu, en clair. */
  unavailableReason?: string;
  /** Signaux retenus, une fois les doublons écartés. */
  count: number;
}

/** Fenêtre d'antériorité par défaut : un signal plus vieux n'est plus un signal. */
export const DEFAULT_SIGNAL_DAYS = 60;

/** Fenêtres proposées dans le formulaire. */
export const SIGNAL_WINDOWS = [7, 30, 60, 90] as const;
