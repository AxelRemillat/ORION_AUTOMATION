"use client";

import { useState, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { ThemeToggle } from "@/components/ui";
import { Sidebar } from "./sidebar";

/**
 * Coquille de l'app : sidebar fixe en desktop, tiroir en mobile, header avec
 * bascule de thème et déconnexion. Les pages sont rendues dans <main>.
 */
export function AppShell({ email, children }: { email: string; children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen md:block">
        <Sidebar />
      </aside>

      {/* Tiroir mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="relative h-full w-60">
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur md:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-label="Ouvrir la navigation"
            className="inline-flex h-9 w-9 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg md:hidden"
          >
            {drawerOpen ? (
              <X className="h-4 w-4" aria-hidden />
            ) : (
              <Menu className="h-4 w-4" aria-hidden />
            )}
          </button>

          <div className="ml-auto flex items-center gap-1">
            <span className="mr-2 hidden text-[13px] text-muted sm:inline">{email}</span>
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                aria-label="Se déconnecter"
                title="Se déconnecter"
                className="inline-flex h-9 w-9 items-center justify-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
