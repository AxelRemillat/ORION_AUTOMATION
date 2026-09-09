import { BarChart3, ListChecks, Search, Send, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Une phrase de contexte, affichee en info-bulle. */
  hint: string;
}

/**
 * Navigation principale, dans l'ordre d'affichage.
 *
 * L'onglet « Cockpit » viendra se placer EN TETE de cette liste quand la page
 * `/cockpit` existera : rien d'autre a modifier, la barre de navigation lit
 * simplement ce tableau. On ne le declare pas tant que la route n'existe pas,
 * pour ne pas exposer un lien mort.
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
];
