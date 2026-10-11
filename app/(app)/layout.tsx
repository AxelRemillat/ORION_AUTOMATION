import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { trashCount } from "@/lib/trash/scope";
import { UndoHost } from "@/components/trash/undo-host";
import { laneOf, LAUNCH_FRESH_DAYS } from "@/lib/opportunities/lane";

/**
 * Layout des routes protégées.
 * Le middleware bloque déjà les visiteurs non connectés ; `requireUser()`
 * garantit ici que l'email affiché dans le header existe bien.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Compteur de la corbeille (prospects + mails), affiché dans le menu du compte.
  const supabase = createClient();
  const db = supabase as unknown as { from: (table: string) => any };
  // Fraîcheur (Cowork #21) : une annonce de plus de 7 jours sans réponse d'Axel ne compte plus, une « Fermée » non plus.
  const freshSince = new Date(Date.now() - LAUNCH_FRESH_DAYS * 86_400_000).toISOString();
  const [prospects, mails, received, alerts, launches] = await Promise.all([
    trashCount(supabase),
    supabase.from("messages").select("id", { count: "exact", head: true }).not("deleted_at", "is", null),
    supabase.from("inbound_messages").select("id", { count: "exact", head: true }).not("deleted_at", "is", null),
    // Alertes de la veille Codeur non vues (score ≥ 8) : badge sur « Opportunités ». Colonne absente → 0.
    (supabase as unknown as { from: (table: string) => any })
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .gte("fit_score", 8)
      .is("seen_at", null)
      .not("status", "in", "(ignoree,fermee)")
      .or(`status.neq.a_repondre,published_at.gte.${freshSince},and(published_at.is.null,created_at.gte.${freshSince})`)
      .then((result: { count: number | null }) => result, () => ({ count: 0 })),
    // Missions de lancement Codeur non vues (11/10/2026) : alertes quel que soit le score, calculées sur le texte.
    db
      .from("opportunities")
      .select("platform, title, body, budget, categories, published_at, created_at, fit_score")
      .eq("platform", "codeur")
      .is("seen_at", null)
      .is("filter_reason", null)
      .neq("status", "ignoree")
      .neq("status", "fermee")
      .gte("created_at", freshSince)
      .limit(300)
      .then(
        (result: { data: { fit_score: number | null }[] | null }) => (result.data ?? []).filter((row) => (row.fit_score ?? 0) < 8 && laneOf(row as never) === "lancement").length,
        () => 0,
      ),
  ]);
  const count = (prospects.count ?? 0) + (mails.count ?? 0) + (received.count ?? 0);

  return (
    <ToastProvider>
      <AppShell email={user.email ?? "compte"} trashCount={count} alertCount={(alerts.count ?? 0) + launches}>
        {children}
      </AppShell>
      <UndoHost />
    </ToastProvider>
  );
}
