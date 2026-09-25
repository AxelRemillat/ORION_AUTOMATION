import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { trashCount } from "@/lib/trash/scope";
import { UndoHost } from "@/components/trash/undo-host";

/**
 * Layout des routes protégées.
 * Le middleware bloque déjà les visiteurs non connectés ; `requireUser()`
 * garantit ici que l'email affiché dans le header existe bien.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Compteur de la corbeille, affiché dans le menu du compte.
  const { count } = await trashCount(createClient());

  return (
    <ToastProvider>
      <AppShell email={user.email ?? "compte"} trashCount={count ?? 0}>
        {children}
      </AppShell>
      <UndoHost />
    </ToastProvider>
  );
}
