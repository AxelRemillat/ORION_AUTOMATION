import { Clock } from "lucide-react";
import type { WhyNow as WhyNowData } from "@/lib/scoring";

/**
 * « Pourquoi maintenant » — la citation de la source qui justifie d'écrire
 * maintenant, jamais une phrase générique.
 *
 * Quand aucun signal n'est attesté, on le dit franchement : mieux vaut une
 * carte honnêtement vide qu'une urgence inventée dans un mail à froid.
 */
export function WhyNowCard({ why }: { why: WhyNowData | null }) {
  if (!why) {
    return (
      <p className="text-[13px]" style={{ color: "var(--faint)" }}>
        Aucun signal récent détecté : l&apos;accroche devra venir d&apos;ailleurs.
      </p>
    );
  }

  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: "var(--line-soft)", background: "var(--surface-2)" }}
    >
      <div className="flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" aria-hidden style={{ color: "var(--primary)" }} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary-ink">
          Pourquoi maintenant
        </span>
      </div>

      {/* Verbatim de la source : citation, donc entre guillemets. */}
      <blockquote
        className="mt-1.5 border-l-2 pl-2.5 text-[13px] leading-snug"
        style={{ borderColor: "var(--primary)", color: "var(--text)" }}
      >
        &laquo;&nbsp;{why.headline}&nbsp;&raquo;
      </blockquote>

      <p className="mt-1.5 text-[11px] leading-snug" style={{ color: "var(--muted)" }}>
        <span className="font-data">{why.evidence}</span>
        {" · "}
        <a
          href={why.url}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-dotted underline-offset-2"
        >
          vérifier la source
        </a>
      </p>
    </div>
  );
}
