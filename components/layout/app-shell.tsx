import type { ReactNode } from "react";
import type { BadgeCounts } from "@/lib/badges/counts";
import { TopNav } from "./top-nav";

/**
 * Coquille de l'app : barre de navigation horizontale, puis le contenu en
 * pleine largeur. `relative z-10` place le contenu au-dessus du halo decoratif
 * pose par `body::before`.
 */
export function AppShell({
  email,
  badges,
  children,
}: {
  email: string;
  /** Valeurs de départ des badges ; la barre les rafraîchit ensuite elle-même. */
  badges: BadgeCounts;
  children: ReactNode;
}) {
  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <TopNav email={email} badges={badges} />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 md:px-6 md:py-10">
        {children}
      </main>
    </div>
  );
}
