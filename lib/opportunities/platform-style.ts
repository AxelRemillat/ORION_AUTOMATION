import { STATUS_LABELS, STATUS_LABELS_EN, type OpportunityStatus, type Platform } from "./types";
import { tabOf, type PlatformTab } from "./tabs";

/**
 * IDENTITÉS VISUELLES PAR PLATEFORME (Cowork #21) — code pur.
 *
 *   Codeur  « l'atelier français » : bleu profond, papier millimétré, badge FR, € à espace fine.
 *   Upwork  « le hub mondial »     : vert, statuts courts en anglais, horloge New York / Paris, $ en mono.
 *   ComeUp  « la vitrine »         : orange corail, cartes en étiquette de prix, commande / demande.
 *
 * Les couleurs vivent dans app/globals.css (tokens --pf-<plateforme>, clair ET sombre) ;
 * la classe `pf-<onglet>` les branche sur --pf-accent, --pf-ink et --pf-bg.
 */

export interface PlatformIdentity {
  /** Classe qui pose les tokens de la plateforme (`pf-codeur`…). */
  theme: string;
  name: string;
  tagline: string;
  /** Statuts en anglais court (Upwork). */
  english: boolean;
}

export const PLATFORM_IDENTITIES: Record<PlatformTab, PlatformIdentity> = {
  codeur: { theme: "pf-codeur", name: "Codeur", tagline: "L'atelier français : missions en France, réponse rapide", english: false },
  upwork: { theme: "pf-upwork", name: "Upwork", tagline: "Le hub mondial : viser les matinées américaines", english: true },
  comeup: { theme: "pf-comeup", name: "ComeUp", tagline: "La vitrine : vos services publiés, commandes et demandes", english: false },
  autres: { theme: "pf-autres", name: "Autres", tagline: "Malt et les autres plateformes, reçues par e-mail", english: false },
};

/** Classe de thème d'une plateforme (badges d'« Aujourd'hui » compris). */
export const platformTheme = (platform: Platform): string => PLATFORM_IDENTITIES[tabOf(platform)].theme;

/** Libellé de statut dans la langue de l'onglet. */
export const statusLabel = (status: OpportunityStatus, tab: PlatformTab): string => (PLATFORM_IDENTITIES[tab].english ? STATUS_LABELS_EN : STATUS_LABELS)[status];

/** Espace fine insécable (U+202F) : « 1 200 € » à la française. */
const THIN = " ";

/** Montant suggéré : euros à espace fine (Codeur…), dollars (Upwork). */
export function priceLabel(amount: number | null | undefined, currency: string | null | undefined, hourly?: boolean): string {
  if (amount == null) return "—";
  if (currency === "USD") return `$${amount.toLocaleString("en-US")}${hourly ? "/hr" : ""}`;
  const digits = String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
  return `${digits}${THIN}€${hourly ? "/h" : ""}`;
}

/** Heure d'un fuseau, « 09:05 » (horloge Upwork New York / Paris). */
export function clockLabel(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

/** ComeUp : la fiche est une commande (payée) ou une demande. */
export const comeupKind = (status: OpportunityStatus): "Commande" | "Demande" => (status === "gagnee" ? "Commande" : "Demande");
