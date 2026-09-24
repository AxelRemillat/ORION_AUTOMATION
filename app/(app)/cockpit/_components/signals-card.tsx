import Link from "next/link";
import { Radio } from "lucide-react";
import { HeatGauge } from "../../recherche/heat-gauge";
import { ExampleTag, SignalChip } from "../../recherche/signal-chip";
import type { SignalHighlight } from "../_lib/types";
import { Radar, SignalBars } from "./radar";

/**
 * « Signaux les plus forts » — le bloc DÉTECTION.
 *
 * Trois registres visuels distincts dans le Cockpit, pour que l'œil sache
 * immédiatement de quoi on lui parle : rouge = agir maintenant, ambre =
 * quelqu'un attend, violet/cyan = quelque chose a été capté. D'où le radar.
 *
 * Volontairement pas titré « signaux frais » : les sources d'enrichissement ne
 * datent pas encore leurs résultats, on ne peut donc pas trier par fraîcheur
 * réelle. Le classement se fait par score, et la note le dit.
 *
 * Le fond animé est décoratif (`aria-hidden`) et posé derrière un contenu
 * opaque : le texte garde son contraste dans les deux thèmes.
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
      className="shadow-mist relative overflow-hidden rounded-xl border"
      style={{ borderColor: "rgb(var(--rgb-violet) / 0.45)", background: "var(--surface)" }}
    >
      <Radar strengths={signals.map((item) => item.score.value / 100)} />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{
          background: "linear-gradient(90deg, rgb(var(--rgb-violet)), rgb(var(--rgb-cyan)))",
        }}
      />

      <div className="relative">
        <div className="flex items-center gap-2 px-5 pb-1 pt-5">
          <Radio className="h-4 w-4 text-violet-ink" aria-hidden />
          <h2 className="text-[15px] font-semibold tracking-tight text-text">
            Signaux les plus forts
          </h2>
          {isExample && <ExampleTag />}
        </div>
        <p className="px-5 pb-3 text-[12px] text-muted">
          Classés par score : les sources ne datent pas encore leurs résultats.
        </p>

        {signals.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-muted">
            Aucun signal capté. Lancez une recherche : le scan repère les entreprises qui bougent.
          </p>
        ) : (
          <ul className="flex flex-col">
            {signals.map((highlight) => (
              <li
                key={`${highlight.prospectId}-${highlight.signal.label}`}
                className="border-t px-5 py-3.5"
                style={{ borderColor: "rgb(var(--rgb-violet) / 0.22)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SignalBars score={highlight.score.value} />
                      {isExample ? (
                        <span className="truncate text-[13px] font-medium text-text">
                          {highlight.companyName}
                        </span>
                      ) : (
                        <Link
                          href={`/suivi/${highlight.prospectId}`}
                          className="truncate text-[13px] font-medium text-text underline-offset-2 hover:underline"
                        >
                          {highlight.companyName}
                        </Link>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] leading-snug text-muted">
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
      </div>
    </section>
  );
}
