import { Briefcase, Gauge, KanbanSquare, Search, Settings, Sun, type LucideIcon } from "lucide-react";

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
 * Les autres destinations, dans l'ordre du travail réel : la vue d'ensemble,
 * les annonces entrantes, le pipeline, les réglages. Prospection n'y figure
 * plus (on l'ouvre depuis une fiche) ; Stats et Coûts sont des sections de
 * Réglages (redirections dans next.config.mjs).
 *
 * RECHERCHE N'EST PLUS UN ONGLET. La prospection se lance par « Lancer
 * maintenant » depuis Aujourd'hui ; la recherche à la main reste entière, mais
 * secondaire — on l'ouvre par le bouton « Recherche avancée » de l'en-tête.
 * Un onglet pour un écran qu'on utilise une fois sur dix dilue la barre.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/cockpit", label: "Cockpit", icon: Gauge, hint: "Vue d'ensemble, activité et consommation" },
  { href: "/opportunites", label: "Opportunités", icon: Briefcase, hint: "Annonces Codeur, Upwork… : analyse et proposition à copier" },
  { href: "/suivi", label: "Pipeline", icon: KanbanSquare, hint: "Pipeline, relances et deals" },
  { href: "/reglages", label: "Réglages", icon: Settings, hint: "Données, coûts, paramètres, intégrations, délivrabilité" },
];

/**
 * La recherche manuelle, hors barre : la route existe toujours (liens,
 * indicateur de jobs, favoris) et c'est Aujourd'hui qui s'allume quand on y
 * est — on n'a pas quitté le travail du jour, on l'a approfondi.
 */
export const SEARCH_ITEM: NavItem = {
  href: "/recherche",
  label: "Recherche avancée",
  icon: Search,
  hint: "Signaux, critères, scan, ajout manuel, favoris",
};

/** Toutes les destinations, « Aujourd'hui » et la recherche comprises. */
export const ALL_NAV_ITEMS: NavItem[] = [HOME_ITEM, ...NAV_ITEMS, SEARCH_ITEM];
