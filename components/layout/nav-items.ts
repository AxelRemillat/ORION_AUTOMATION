import { BarChart3, Gauge, KanbanSquare, Search, Sun, Wallet, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Une phrase de contexte, affichee en info-bulle. */
  hint: string;
}

/**
 * « Aujourd'hui » est traite a part.
 *
 * Ce n'est pas une etape du workflow mais l'ecran du matin : la file preparee
 * pendant la nuit, a relire et programmer. La barre de navigation l'affiche
 * isole, a gauche d'un separateur.
 */
export const HOME_ITEM: NavItem = {
  href: "/aujourdhui",
  label: "Aujourd'hui",
  icon: Sun,
  hint: "La file du jour : réponses, relances, nouveaux prospects",
};

/**
 * Les autres destinations. Prospection n'y figure plus : on l'ouvre depuis une
 * fiche. Stats et Coûts y restent jusqu'a l'arrivee de Reglages.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/cockpit", label: "Cockpit", icon: Gauge, hint: "Vue d'ensemble, activité et consommation" },
  { href: "/recherche", label: "Recherche", icon: Search, hint: "Trouver de nouveaux prospects" },
  { href: "/suivi", label: "Pipeline", icon: KanbanSquare, hint: "Pipeline, relances et deals" },
  { href: "/stats", label: "Stats", icon: BarChart3, hint: "Performance de la prospection" },
  {
    href: "/couts",
    label: "Coûts",
    icon: Wallet,
    hint: "Consommation des APIs et coût par prospect",
  },
];

/** Toutes les destinations, « Aujourd'hui » compris. */
export const ALL_NAV_ITEMS: NavItem[] = [HOME_ITEM, ...NAV_ITEMS];
