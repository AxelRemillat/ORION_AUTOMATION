/**
 * En-tête du Cockpit — la signature visuelle d'ORION.
 * --accent-grad pose un filet lumineux en haut, --halo diffuse la brume derrière
 * le titre. Les deux couches sont décoratives (`aria-hidden`) et n'entravent pas
 * le pointeur. Aucune couleur codée en dur : tout vient des tokens de thème.
 */
export function CockpitHeader({
  title,
  subtitle,
  date,
}: {
  title: string;
  subtitle: string;
  date: string;
}) {
  return (
    <header
      className="shadow-mist relative overflow-hidden rounded-xl border p-6 sm:p-8"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <div
        aria-hidden
        className="bg-brand-grad pointer-events-none absolute inset-x-0 top-0 h-1"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--halo)" }}
      />

      <div className="relative">
        <p className="font-data text-[11px] font-semibold uppercase tracking-[0.12em] text-primary-ink">
          {date}
        </p>
        <h1
          className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl"
          style={{ color: "var(--text)" }}
        >
          {title}
        </h1>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          {subtitle}
        </p>
      </div>
    </header>
  );
}
