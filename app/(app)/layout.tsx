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
  // Compteur de la corbeille (prospects + mails), affiché dans le menu du compte.
  const supabase = createClient();
  const [prospects, mails, received, alerts] = await Promise.all([
    trashCount(supabase),
    supabase.from("messages").select("id", { count: "exact", head: true }).not("deleted_at", "is", null),
    supabase.from("inbound_messages").select("id", { count: "exact", head: true }).not("deleted_at", "is", null),
    // Alertes de la veille Codeur non vues (score ≥ 8) : badge sur « Opportunités ». Colonne absente → 0.
    (supabase as unknown as { from: (table: string) => any })
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .gte("fit_score", 8)
      .is("seen_at", null)
      .neq("status", "ignoree")
      .then((result: { count: number | null }) => result, () => ({ count: 0 })),
  ]);
  const count = (prospects.count ?? 0) + (mails.count ?? 0) + (received.count ?? 0);

  return (
    <ToastProvider>
      <AppShell email={user.email ?? "compte"} trashCount={count} alertCount={alerts.count ?? 0}>
        {children}
      </AppShell>
      <UndoHost />
    </ToastProvider>
  );
}
