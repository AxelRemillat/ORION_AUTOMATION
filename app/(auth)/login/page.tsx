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
    <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <span className="h-7 w-7 rounded-lg bg-brand-grad shadow-mist" aria-hidden />
          <span className="font-display text-lg font-semibold tracking-tight text-text">
            PROSPECT
          </span>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-7 shadow-mist">
          <span className="absolute inset-x-0 top-0 h-px bg-brand-grad" aria-hidden />
          <h1 className="font-display text-xl font-semibold tracking-tight text-text">Connexion</h1>
          <p className="mb-6 mt-1.5 text-[13px] leading-relaxed text-muted">
            Accès réservé. Un seul compte est autorisé sur cette instance.
          </p>
          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-xs text-faint">
          Mot de passe oublié ? Réinitialise-le depuis le tableau de bord Supabase.
        </p>
      </div>
    </main>
  );
}
