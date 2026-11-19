import { Archive, Briefcase, Calculator, Contact, Search, Settings, Sun, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Une phrase de contexte, affichee en info-bulle. */
  hint: string;
}

/**
 * « Aujourd'hui » est traite a part : l'ecran du matin, isole a gauche d'un separateur.
 *
 * Refonte CRM (Cowork #117, 18/11/2026) : ce sont desormais les TACHES CRM du jour (relances, visites, devis a
 * envoyer). L'ancien ecran des mails n'est pas supprime : il vit sous « Archives › Prospection e-mail », en
 * lecture seule (ARCHIVES_ITEM).
 */
export const HOME_ITEM: NavItem = {
  href: "/aujourdhui",
  label: "Aujourd'hui",
  icon: Sun,
  hint: "Les actions CRM du jour : relances, visites, devis",
};

/**
 * Les destinations, dans l'ordre du travail reel (Cowork #117) : le CRM, les annonces Upwork / ComeUp, les
 * comptabilite de la micro-entreprise (agent4, Cowork #70 : routes /compta), les reglages.
 *
 * RETIRES DE LA BARRE, PAS SUPPRIMES : Cockpit (/cockpit) et Pipeline (/suivi) restent des routes valides,
 * ouvertes depuis l'archive de la prospection e-mail. La recherche avancee (/recherche) aussi.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/crm", label: "CRM", icon: Contact, hint: "Commerces prospectés et clients du Web des Artisans" },
  { href: "/opportunites", label: "Opportunités", icon: Briefcase, hint: "Annonces Upwork et ComeUp : analyse et proposition à copier" },
  { href: "/compta", label: "Compta", icon: Calculator, hint: "Devis, factures, recettes, dépenses, URSSAF et seuils" },
  { href: "/reglages", label: "Réglages", icon: Settings, hint: "Données, coûts, paramètres, intégrations" },
];

/** L'ancienne prospection par e-mail, en lecture seule : lien secondaire (icone), hors de la rangee d'onglets. */
export const ARCHIVES_ITEM: NavItem = {
  href: "/archives/prospection-email",
  label: "Archives › Prospection e-mail",
  icon: Archive,
  hint: "Ancien écran des mails (lecture seule), Cockpit et Pipeline",
};

/** La recherche manuelle, hors barre : la route existe toujours (liens, favoris). */
export const SEARCH_ITEM: NavItem = {
  href: "/recherche",
  label: "Recherche avancée",
  icon: Search,
  hint: "Signaux, critères, scan, ajout manuel, favoris",
};

/** Toutes les destinations, « Aujourd'hui », l'archive et la recherche comprises. */
export const ALL_NAV_ITEMS: NavItem[] = [HOME_ITEM, ...NAV_ITEMS, ARCHIVES_ITEM, SEARCH_ITEM];
