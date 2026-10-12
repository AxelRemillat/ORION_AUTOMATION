import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { badgeCounts } from "@/lib/badges/counts";
import { UndoHost } from "@/components/trash/undo-host";

/**
 * Layout des routes protégées.
 * Le middleware bloque déjà les visiteurs non connectés ; `requireUser()`
 * garantit ici que l'email affiché dans le header existe bien.
 *
 * Les badges (alertes, non lus, corbeille) viennent tous de `badgeCounts`, qui
 * porte les règles. Ce rendu serveur ne donne que leur valeur de DÉPART : la
 * barre les rafraîchit elle-même à chaque navigation (Cowork #21).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const badges = await badgeCounts(createClient());

  return (
    <ToastProvider>
      <AppShell email={user.email ?? "compte"} badges={badges}>
        {children}
      </AppShell>
      <UndoHost />
    </ToastProvider>
  );
}
