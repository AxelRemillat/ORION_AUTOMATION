import Link from "next/link";
import { Radar } from "lucide-react";
import { HeatGauge } from "../../recherche/heat-gauge";
import { ExampleTag, SignalChip } from "../../recherche/signal-chip";
import type { SignalHighlight } from "../_lib/types";

/**
 * Signaux du portefeuille, du plus fort au plus faible.
 *
 * Volontairement pas titré « signaux frais » : les sources d'enrichissement ne
 * datent pas encore leurs résultats, on ne peut donc pas trier par fraîcheur
 * réelle. Le classement se fait par score de chaleur, et la note le dit.
 */
export function SignalsCard({
  signals,
  isExample,
}: {
  signals: SignalHighlight[];
  isExample: boolean;
}) {
  return (
    <section
      className="shadow-mist rounded-xl border"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <div className="flex items-center gap-2 px-5 pb-1 pt-5">
        <Radar className="h-4 w-4" aria-hidden style={{ color: "var(--primary)" }} />
        <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--text)" }}>
          Signaux les plus forts
        </h2>
        {isExample && <ExampleTag />}
      </div>
      <p className="px-5 pb-3 text-[12px]" style={{ color: "var(--faint)" }}>
        Classés par score de chaleur : les sources ne datent pas encore leurs résultats.
      </p>

      {signals.length === 0 ? (
        <p className="px-5 pb-5 text-[13px]" style={{ color: "var(--faint)" }}>
          Aucun signal enregistré. Lancez une recherche avec les signaux web activés.
        </p>
      ) : (
        <ul className="flex flex-col">
          {signals.map((highlight) => (
            <li
              key={`${highlight.prospectId}-${highlight.signal.label}`}
              className="border-t px-5 py-3.5"
              style={{ borderColor: "var(--line-soft)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {isExample ? (
                    <span
                      className="block truncate text-[13px] font-medium"
                      style={{ color: "var(--text)" }}
                    >
                      {highlight.companyName}
                    </span>
                  ) : (
                    <Link
                      href={`/suivi/${highlight.prospectId}`}
                      className="block truncate text-[13px] font-medium underline-offset-2 hover:underline"
                      style={{ color: "var(--text)" }}
                    >
                      {highlight.companyName}
                    </Link>
                  )}
                  <p className="mt-0.5 text-[12px] leading-snug" style={{ color: "var(--muted)" }}>
                    {highlight.signal.label}
                  </p>
                </div>
                <SignalChip type={highlight.signal.type} />
              </div>

              <div className="mt-2.5">
                <HeatGauge score={highlight.score} compact />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
