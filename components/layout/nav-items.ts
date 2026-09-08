import { BarChart3, ListChecks, Search, Send, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Une phrase de contexte, affichée en info-bulle. */
  hint: string;
}

/** Navigation principale. Chaque section est portée par un agent dédié. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/recherche", label: "Recherche", icon: Search, hint: "Trouver de nouveaux prospects" },
  { href: "/prospection", label: "Prospection", icon: Send, hint: "Rédiger et envoyer les messages" },
  { href: "/suivi", label: "Suivi", icon: ListChecks, hint: "Pipeline, relances et deals" },
  { href: "/stats", label: "Stats", icon: BarChart3, hint: "Performance de la prospection" },
];
