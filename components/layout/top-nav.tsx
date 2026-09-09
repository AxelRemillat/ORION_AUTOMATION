"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui";
import { NAV_ITEMS } from "./nav-items";

/**
 * Barre de navigation horizontale, collee en haut.
 *
 * Logo a gauche, onglets au centre, compte a droite. Sur mobile la rangee
 * d'onglets defile horizontalement (pas de menu burger : quatre destinations
 * tiennent a l'ecran et un burger cacherait la structure de l'app).
 */
export function TopNav({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 md:px-6">
        {/* Marque */}
        <Link
          href="/recherche"
          className="flex shrink-0 items-center gap-2.5"
          aria-label="PROSPECT, accueil"
        >
          <span className="h-6 w-6 rounded-lg bg-brand-grad shadow-mist" aria-hidden />
          <span className="font-display text-[15px] font-semibold tracking-tight text-text">
            PROSPECT
          </span>
        </Link>

        {/* Onglets */}
        <nav
          aria-label="Navigation principale"
          className="scrollbar-none -mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 sm:justify-center"
        >
          {NAV_ITEMS.map(({ href, label, icon: Icon, hint }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                title={hint}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
                  "transition-colors",
                  active ? "text-text" : "text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
                {/* Soulignage degrade de l'onglet actif — la signature de marque. */}
                {active && (
                  <span
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-grad"
                    aria-hidden
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Compte */}
        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-1 hidden font-data text-[12px] text-muted lg:inline">{email}</span>
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
