"use client";

import { ScoreCounter } from "./score-counter";

/**
 * « JOURNÉE COMPLÈTE » — l'écran de fin de round.
 *
 * Posé dans la carte, pas en plein écran : il célèbre sans bloquer. Le parent
 * le démonte après 1,8 s, puis la carte passe en état calme.
 *
 * Purement décoratif pour les lecteurs d'écran : le compteur sous-jacent porte
 * déjà l'information, et le toast de validation l'annonce.
 */
export function RoundCompleteOverlay({ total }: { total: number }) {
  return (
    <div
      aria-hidden
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 motion-safe:animate-fade-in"
      style={{ background: "rgb(var(--rgb-vs-stage) / 0.86)", backdropFilter: "blur(2px)" }}
    >
      {/* Les deux streaks se referment sur le titre. */}
      <span
        aria-hidden
        className="motion-safe:vs-breathe h-px w-full"
        style={{
          background: "linear-gradient(90deg, transparent, var(--vs-ink), transparent)",
          boxShadow: "0 0 12px rgb(var(--rgb-vs-ink) / 0.7)",
        }}
      />

      <p
        className="font-versus px-4 text-center text-[clamp(32px,7vw,64px)] font-extrabold italic uppercase leading-none tracking-[-0.02em]"
        style={{
          color: "var(--vs-ink)",
          textShadow: "-2px 0 rgb(var(--rgb-vs-red) / 0.55), 2px 0 rgb(var(--rgb-vs-blue) / 0.55)",
        }}
      >
        Journée complète
      </p>

      <ScoreCounter done={total} total={total} size="xl" celebrate />

      <span
        aria-hidden
        className="motion-safe:vs-breathe h-px w-full"
        style={{
          background: "linear-gradient(90deg, transparent, var(--vs-ink), transparent)",
          boxShadow: "0 0 12px rgb(var(--rgb-vs-ink) / 0.7)",
        }}
      />
    </div>
  );
}
