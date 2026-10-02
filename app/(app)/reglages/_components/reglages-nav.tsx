"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, Gauge, Mail, Plug, SlidersHorizontal, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Menu des Réglages : colonne à gauche sur grand écran, onglets défilants en
 * haut sur mobile. Une URL par section (/reglages/donnees…).
 */
export const SECTIONS = [
  { href: "/reglages/donnees", label: "Données", icon: Database },
  { href: "/reglages/couts", label: "Coûts", icon: Wallet },
  { href: "/reglages/parametres", label: "Paramètres", icon: SlidersHorizontal },
  { href: "/reglages/integrations", label: "Intégrations", icon: Plug },
  { href: "/reglages/delivrabilite", label: "Délivrabilité", icon: Mail },
] as const;

export function ReglagesNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections des réglages" className="-mx-1 overflow-x-auto scrollbar-none lg:mx-0 lg:overflow-visible">
      <ul className="flex gap-1 px-1 lg:flex-col lg:px-0">
        {SECTIONS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] transition-colors",
                  active ? "bg-primary/10 font-medium text-primary-ink" : "text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
        <li className="hidden lg:mt-3 lg:block lg:border-t lg:border-line-soft lg:pt-3">
          <Link href="/cockpit#pilotage" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-faint hover:text-text">
            <Gauge className="h-4 w-4" aria-hidden />
            Graphe de consommation
          </Link>
        </li>
      </ul>
    </nav>
  );
}
