"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-items";

/**
 * Un onglet. `home` distingue le Cockpit : fond legerement appuye et icone
 * teintee, pour qu'il se lise comme un tableau de bord et non comme une etape.
 */
export function NavTab({
  item,
  pathname,
  home = false,
  badge = 0,
  badgeLabel,
  tone = "good",
}: {
  item: NavItem;
  pathname: string;
  home?: boolean;
  /** Pastille : alertes non vues, mails non lus. */
  badge?: number;
  /** Ce que la pastille annonce aux lecteurs d'écran. */
  badgeLabel?: (count: number) => string;
  tone?: "good" | "warn";
}) {
  const { href, label, icon: Icon, hint } = item;
  /*
   * La recherche manuelle n a plus d onglet : quand on y est, c est Aujourd hui
   * qui reste allume. On ne quitte pas le travail du jour, on l approfondit.
   */
  const active =
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (home && pathname.startsWith("/recherche"));

  return (
    <Link
      href={href}
      title={hint}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
        "transition-colors",
        home && "border border-line bg-surface-2",
        active ? "text-text" : "text-muted hover:bg-surface-2 hover:text-text",
        home && active && "border-primary/30 bg-primary/10",
      )}
    >
      <Icon className={cn("h-4 w-4", home && "text-primary")} aria-hidden />
      {label}
      {badge > 0 && (
        <span
          aria-label={badgeLabel ? badgeLabel(badge) : `${badge} alerte${badge > 1 ? "s" : ""} non vue${badge > 1 ? "s" : ""}`}
          className={cn(
            "font-data min-w-[18px] rounded-full px-1 text-center text-[10px] leading-[18px] ring-1",
            tone === "warn" ? "bg-warn/15 text-warn-ink ring-warn/25" : "bg-good/15 text-good-ink ring-good/25",
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {/* Soulignage degrade de l'onglet actif — la signature de marque. */}
      {active && !home && (
        <span
          className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-grad"
          aria-hidden
        />
      )}
    </Link>
  );
}
