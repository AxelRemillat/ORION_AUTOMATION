import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion · PROSPECT" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  // On n'accepte qu'un chemin interne comme redirection (pas d'URL absolue).
  const next =
    searchParams.next?.startsWith("/") && !searchParams.next.startsWith("//")
      ? searchParams.next
      : "/recherche";

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="h-3 w-3 rounded-sm bg-accent" aria-hidden />
          <span className="text-base font-semibold tracking-tight text-fg">PROSPECT</span>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
          <h1 className="text-lg font-semibold tracking-tight text-fg">Connexion</h1>
          <p className="mb-6 mt-1 text-[13px] text-muted">
            Accès réservé. Un seul compte est autorisé sur cette instance.
          </p>
          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Compte oublié ? Réinitialise le mot de passe depuis le tableau de bord Supabase.
        </p>
      </div>
    </main>
  );
}
