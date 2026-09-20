import type { Metadata } from "next";
import { Logo } from "@/components/ui";
import { LoginForm } from "./login-form";
import { NeuralBackground } from "./neural-background";

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
      : "/cockpit";

  return (
    <>
      {/* Reseau anime : couche de fond (z-0), sans pointer-events. */}
      <NeuralBackground />

      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
        <div className="relative w-full max-w-sm">
          {/*
            Voile radial : le reseau est dense, ce halo de couleur de fond le
            calme autour de la colonne de texte. La carte etant opaque, il ne
            sert qu'au wordmark et a la ligne de pied.
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-14 -inset-y-12 rounded-[2.5rem]"
            style={{
              background:
                "radial-gradient(closest-side, rgb(var(--rgb-bg) / 0.92), rgb(var(--rgb-bg) / 0))",
            }}
          />

          <div className="relative">
            <div className="mb-8 flex flex-col items-center gap-3">
              <Logo size="lg" priority />
              <span className="font-display text-lg font-semibold tracking-tight text-text">
                PROSPECT
              </span>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-7 shadow-mist">
              <span className="absolute inset-x-0 top-0 h-px bg-brand-grad" aria-hidden />
              <h1 className="font-display text-xl font-semibold tracking-tight text-text">
                Connexion
              </h1>
              <p className="mb-6 mt-1.5 text-[13px] leading-relaxed text-muted">
                Accès réservé. Un seul compte est autorisé sur cette instance.
              </p>
              <LoginForm next={next} />
            </div>

            <p className="mt-6 text-center text-xs text-muted">
              Mot de passe oublié ? Réinitialise-le depuis le tableau de bord Supabase.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
