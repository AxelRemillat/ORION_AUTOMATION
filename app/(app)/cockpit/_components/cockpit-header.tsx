import { HeroScene } from "./hero-scene/hero-scene";
import type { FreelanceSource } from "@/lib/opportunities/stats";

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
  sources,
}: {
  title: string;
  subtitle: string;
  date: string;
  /** Prospection freelance (Codeur, Upwork, Malt/ComeUp) : envoyées et taux de réponse sur 30 jours. */
  sources?: FreelanceSource[];
}) {
  return (
    <header
      className="shadow-mist relative overflow-hidden rounded-xl border"
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

      {/* Scène décorative : bandeau en haut sur mobile, moitié droite ensuite.
          Posée APRÈS le halo, pour qu'il ne la voile pas. */}
      <HeroScene />

      {/* Le texte reste dans la moitié gauche : jamais sur la scène. */}
      <div className="relative p-6 sm:w-1/2 sm:p-8">
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
        {sources && sources.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Prospection freelance, 30 derniers jours">
            {sources.map((source) => (
              <li
                key={source.key}
                className="rounded-full border border-line bg-surface/80 px-2.5 py-1 text-[12px]"
                title={`${source.label} : ${source.sent} proposition(s) envoyée(s), ${source.replies} réponse(s) sur 30 jours`}
              >
                <span className="text-text">{source.label}</span>{" "}
                <span className="font-data text-muted">
                  {source.sent} env. · {source.replyRate === null ? "—" : `${Math.round(source.replyRate * 100)} %`} de réponse
                </span>
              </li>
            ))}
            <li className="px-1 py-1 text-[11px] text-faint">30 j</li>
          </ul>
        )}
      </div>
    </header>
  );
}
