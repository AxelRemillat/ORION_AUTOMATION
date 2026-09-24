"use client";

import Link from "next/link";
import { ArrowRight, Check, Clock } from "lucide-react";
import type { QueueAction } from "../../_lib/queue";
import { GhostButton, HeatGauge, SKEW, UNSKEW } from "./row-parts";

/**
 * Une ligne de la file, en verre sombre sur la scène.
 *
 * La bordure est un dégradé bleu → rouge : impossible en `border-color`, elle
 * passe donc par un fond dégradé de 1 px sur lequel repose le verre. Au survol,
 * une light streak traverse la ligne et la bordure s'illumine.
 */

export type RowState = "idle" | "done" | "snoozed";

/** Le front va du bleu au rouge : froid à gauche, brûlant à droite. */
function heatColor(score: number): string {
  if (score < 40) return "var(--vs-blue)";
  if (score <= 70) return "rgb(var(--rgb-violet))";
  return "var(--vs-red)";
}

export function ActionRow({
  action,
  state,
  disabled,
  onDone,
  onSnooze,
}: {
  action: QueueAction;
  state: RowState;
  disabled: boolean;
  onDone: () => void;
  onSnooze: () => void;
}) {
  // Les lignes « approche » portent déjà le score dans leur motif : la jauge le
  // reprend, et on ne réaffiche pas la phrase qu'elle remplace.
  const scored = /Score de chaleur (\d+)\/100/.exec(action.reason);
  const score = scored ? Number(scored[1]) : Math.round(action.heat * 100);
  const accent = heatColor(score);

  // L'entree se termine a opacity 1 (`fill-mode: both`). La sortie n'attenue
  // que la ligne resolue : les autres restent pleinement lisibles.
  const animation =
    state === "done"
      ? "motion-safe:vs-collapse"
      : state === "snoozed"
        ? "motion-safe:vs-snooze-out"
        : "motion-safe:vs-row-in";

  return (
    <li
      className={`group relative origin-top ${animation}`}
      style={{ listStyle: "none", opacity: state === "snoozed" ? 0.55 : 1 }}
    >
      {/* Éclair de validation : balaie la ligne avant qu'elle se replie. */}
      {state === "done" && (
        <span
          aria-hidden
          className="motion-safe:vs-flash pointer-events-none absolute inset-y-0 left-0 z-10 w-1/3 rounded-xl"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--vs-ink), transparent)",
            opacity: 0.85,
          }}
        />
      )}

      {/*
        L'alpha est DANS les couleurs du degrade, pas en `opacity` sur le
        conteneur : `opacity` cree un contexte d'empilement et s'applique a tout
        le sous-arbre — c'est ce qui delavait le nom, la jauge et les boutons.
      */}
      <div
        className="rounded-xl p-px"
        style={{
          background:
            "linear-gradient(120deg, rgb(var(--rgb-vs-blue) / 0.35), rgb(var(--rgb-vs-red) / 0.35))",
        }}
      >
        <div
          className="relative overflow-hidden rounded-[11px] px-3.5 py-3"
          style={{
            // L'effet verre vient du fond seul : opaque a 55 %, flou derriere.
            background: "rgb(var(--rgb-vs-stage) / 0.55)",
            backdropFilter: "blur(8px)",
          }}
        >
          {/* Light streak de survol. */}
          <span
            aria-hidden
            className="vs-sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3"
            style={{
              background: "linear-gradient(90deg, transparent, rgb(var(--rgb-vs-ink) / 0.14), transparent)",
            }}
          />

          <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 h-9 w-[3px] shrink-0 rounded-full"
                style={{ background: accent, boxShadow: `0 0 10px ${accent}` }}
              />
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm font-semibold"
                  style={{ color: "rgb(var(--rgb-vs-ink) / 0.95)" }}
                >
                  {action.title}
                </p>
                {!scored && (
                  <p className="mt-0.5 text-[12px]" style={{ color: "var(--vs-ink-soft)" }}>
                    {action.reason}
                  </p>
                )}
                <HeatGauge score={score} accent={accent} />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 md:gap-1.5">
              <Link
                href={action.href}
                style={{ ...SKEW, background: "var(--vs-ink)", color: "var(--vs-stage)" }}
                className="vs-cta inline-flex items-center px-3.5 py-2 text-[13px] font-semibold motion-safe:transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <span style={UNSKEW} className="inline-flex items-center gap-1.5">
                  {action.cta}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </span>
              </Link>

              <GhostButton
                label={`Marquer « ${action.title} » comme fait`}
                title="Marquer comme fait"
                disabled={disabled}
                onClick={onDone}
              >
                <Check className="h-4 w-4" aria-hidden />
              </GhostButton>

              <GhostButton
                label={`Reporter « ${action.title} » à demain`}
                title="Reporter à demain"
                disabled={disabled}
                onClick={onSnooze}
              >
                <Clock className="h-4 w-4" aria-hidden />
              </GhostButton>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
