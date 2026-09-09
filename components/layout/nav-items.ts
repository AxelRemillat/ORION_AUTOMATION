import { BarChart3, Gauge, ListChecks, Search, Send, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Une phrase de contexte, affichee en info-bulle. */
  hint: string;
}

/**
 * Navigation principale, dans l'ordre d'affichage.
 * La barre de navigation lit simplement ce tableau : ajouter une destination
 * revient a inserer une entree ici, rien d'autre.
 *
 * Le Cockpit est l'accueil de l'app : il ouvre la liste et sert de cible aux
 * redirections par defaut (racine, post-connexion).
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/cockpit", label: "Cockpit", icon: Gauge, hint: "Vue d'ensemble et priorités du jour" },
  { href: "/recherche", label: "Recherche", icon: Search, hint: "Trouver de nouveaux prospects" },
  {
    href: "/prospection",
    label: "Prospection",
    icon: Send,
    hint: "Rédiger et envoyer les messages",
  },
  { href: "/suivi", label: "Suivi", icon: ListChecks, hint: "Pipeline, relances et deals" },
  { href: "/stats", label: "Stats", icon: BarChart3, hint: "Performance de la prospection" },
];
