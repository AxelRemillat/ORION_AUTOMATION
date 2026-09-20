import { BarChart3, Gauge, ListChecks, Search, Send, Wallet, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Une phrase de contexte, affichee en info-bulle. */
  hint: string;
}

/**
 * Le Cockpit est traite a part.
 *
 * Ce n'est pas une etape du workflow mais le tableau de bord quotidien : la
 * barre de navigation l'affiche isole, a gauche d'un separateur, pour que la
 * distinction se voie sans avoir a lire les libelles.
 */
export const HOME_ITEM: NavItem = {
  href: "/cockpit",
  label: "Cockpit",
  icon: Gauge,
  hint: "Vue d'ensemble et priorités du jour",
};

/**
 * Les etapes du workflow, dans l'ordre ou on les traverse.
 * Ajouter une destination revient a inserer une entree ici, rien d'autre.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/recherche", label: "Recherche", icon: Search, hint: "Trouver de nouveaux prospects" },
  {
    href: "/prospection",
    label: "Prospection",
    icon: Send,
    hint: "Rédiger et envoyer les messages",
  },
  { href: "/suivi", label: "Suivi", icon: ListChecks, hint: "Pipeline, relances et deals" },
  { href: "/stats", label: "Stats", icon: BarChart3, hint: "Performance de la prospection" },
  {
    href: "/couts",
    label: "Coûts",
    icon: Wallet,
    hint: "Consommation des APIs et coût par prospect",
  },
];

/** Toutes les destinations, Cockpit compris. */
export const ALL_NAV_ITEMS: NavItem[] = [HOME_ITEM, ...NAV_ITEMS];
