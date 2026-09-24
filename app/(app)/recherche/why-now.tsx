import { Clock } from "lucide-react";
import type { WhyNow as WhyNowData } from "@/lib/scoring";

/**
 * « Pourquoi maintenant » — la preuve qui justifie d'écrire aujourd'hui.
 *
 * Deux corrections par rapport à la version précédente :
 *
 * 1. La citation arrivait BRUTE du web. On lisait « - [Voir l'offre](https://…)
 *    🔥 **Automaticien** H/F » dans une carte censée être lisible. Le nettoyage
 *    se fait maintenant en amont (`whyNow`), et ce composant n'affiche plus que
 *    du texte.
 *
 * 2. Tout reposait sur le verbatim. On affiche désormais d'abord la lecture
 *    STRUCTURÉE — le poste, la date ou « en ligne » — et la citation vient
 *    ensuite, comme pièce justificative. Une offre sans date le dit franchement
 *    plutôt que de laisser croire à une actualité fraîche.
 *
 * Quand aucun signal n'est attesté, on le dit : mieux vaut une carte
 * honnêtement vide qu'une urgence inventée dans un mail à froid.
 */
export function WhyNowCard({ why }: { why: WhyNowData | null }) {
  if (!why) {
    return (
      <p className="text-[13px]" style={{ color: "var(--faint)" }}>
        Aucun signal récent détecté : l&apos;accroche devra venir d&apos;ailleurs.
      </p>
    );
  }

  // « en ligne, non datée » n'est pas une date : on le montre comme un état.
  const undated = why.when === "en ligne, non datée";

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

      {/* Lecture structurée : ce qu'on a compris, avant la citation. */}
      {why.role && (
        <p className="mt-1.5 text-[13px] font-medium leading-snug" style={{ color: "var(--text)" }}>
          Poste ouvert : {why.role}
          {why.when && (
            <span
              className="ml-1.5 font-data text-[11px] font-normal"
              style={{ color: undated ? "var(--warn-ink)" : "var(--muted)" }}
            >
              {undated ? "en ligne, non datée" : why.when}
            </span>
          )}
        </p>
      )}

      {/* Verbatim de la source : citation, donc entre guillemets. */}
      <blockquote
        className="mt-1.5 border-l-2 pl-2.5 text-[13px] leading-snug"
        style={{ borderColor: "var(--primary)", color: why.role ? "var(--muted)" : "var(--text)" }}
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
