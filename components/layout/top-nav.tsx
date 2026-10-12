"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgeCheck, LogOut, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo, ThemeToggle } from "@/components/ui";
import type { BadgeCounts } from "@/lib/badges/counts";
import { useBadges } from "./use-badges";
import { JobsIndicator } from "./jobs-indicator";
import { OutboxIndicator } from "./outbox-indicator";
import { HOME_ITEM, NAV_ITEMS } from "./nav-items";
import { NavTab } from "./nav-tab";

/**
 * Barre de navigation horizontale, collee en haut.
 *
 * Logo a gauche, onglets au centre, compte a droite. Sur mobile la rangee
 * d'onglets defile horizontalement (pas de menu burger : quatre destinations
 * tiennent a l'ecran et un burger cacherait la structure de l'app).
 */
export function TopNav({ email, badges }: { email: string; badges: BadgeCounts }) {
  const pathname = usePathname();
  // Recalcules a chaque navigation : un badge figé ne veut plus rien dire.
  const { alerts, unread, trash } = useBadges(badges);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 md:px-6">
        {/* Marque */}
        <Link
          href="/aujourdhui"
          className="flex shrink-0 items-center gap-2.5"
          aria-label="PROSPECT, accueil"
        >
          <Logo size="sm" priority />
          <span className="font-display text-[15px] font-semibold tracking-tight text-text">
            PROSPECT
          </span>
        </Link>

        {/* Navigation : « Aujourd’hui » d’abord, isole du reste par un separateur. */}
        <nav
          aria-label="Navigation principale"
          className="scrollbar-none -mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 sm:justify-center"
        >
          <NavTab item={HOME_ITEM} pathname={pathname} home />

          <span
            aria-hidden
            className="mx-1.5 h-5 w-px shrink-0 rounded-full bg-line"
          />

          {NAV_ITEMS.map((item) => (
            <NavTab
              key={item.href}
              item={item}
              pathname={pathname}
              badge={item.href === "/opportunites" ? alerts : item.href === "/cockpit" ? unread : 0}
              badgeLabel={
                item.href === "/cockpit"
                  ? (count) => `${count} mail${count > 1 ? "s" : ""} reçu${count > 1 ? "s" : ""} non lu${count > 1 ? "s" : ""}`
                  : undefined
              }
              tone={item.href === "/cockpit" ? "warn" : "good"}
            />
          ))}
        </nav>

        {/* Compte */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Visible sur toutes les pages tant qu'une recherche ou un mail tourne. */}
          <JobsIndicator />
          {/* Envois programmés : à venir, partis, échoués. */}
          <OutboxIndicator />
          <span className="mr-1 hidden font-data text-[12px] text-muted lg:inline">{email}</span>
          <Link
            href="/corbeille"
            aria-label={`Corbeille${trash ? ` (${trash})` : ""}`}
            title="Corbeille"
            aria-current={pathname.startsWith("/corbeille") ? "page" : undefined}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {trash > 0 && (
              <span className="font-data absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-surface-2 px-1 text-center text-[10px] leading-4 text-text ring-1 ring-line">
                {trash > 99 ? "99+" : trash}
              </span>
            )}
          </Link>
          <Link
            href="/offre"
            aria-label="Mon offre"
            title="Mon offre — signature, preuves, demande d'entrée"
            aria-current={pathname.startsWith("/offre") ? "page" : undefined}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <BadgeCheck className="h-4 w-4" aria-hidden />
          </Link>
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              aria-label="Se déconnecter"
              title="Se déconnecter"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
