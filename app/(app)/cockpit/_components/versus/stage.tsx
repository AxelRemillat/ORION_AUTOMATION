/**
 * Le decor de la scene : les deux halos qui se font face, et le grain.
 *
 * Le centre est volontairement re-assombri par un troisieme halo : sans lui,
 * les deux camps se rejoignent au milieu et le titre perd son contraste.
 */

/** Grain : une turbulence SVG, plus légère qu'une image et sans requête. */
const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function Stage({ calm }: { calm: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 motion-safe:transition-opacity motion-safe:duration-700"
        style={{
          // File vide : les camps se retirent, la carte se calme.
          opacity: calm ? 0.35 : 1,
          background:
            "radial-gradient(60% 90% at 2% 50%, rgb(var(--rgb-cyan) / 0.42), transparent 62%)," +
            "radial-gradient(60% 90% at 98% 50%, rgb(var(--rgb-vs-red) / 0.38), transparent 62%)," +
            "radial-gradient(70% 60% at 50% 50%, rgb(var(--rgb-vs-stage) / 0.9), transparent 70%)",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: NOISE }}
      />
    </>
  );
}

/** Light streak : 1 px, transparent → blanc → transparent, qui respire. */
export function Streak() {
  return (
    <span
      aria-hidden
      className="motion-safe:vs-breathe block h-px w-full"
      style={{
        background: "linear-gradient(90deg, transparent, var(--vs-ink), transparent)",
        boxShadow: "0 0 10px rgb(var(--rgb-vs-ink) / 0.55)",
      }}
    />
  );
}
