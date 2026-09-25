"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Radar, Square } from "lucide-react";
import { Button } from "@/components/ui";
import type { SearchRun } from "@/types";
import { progressRatio } from "@/lib/search/runs";
import { readProgress } from "./use-search-run";

/**
 * Avancement d'un scan en cours.
 *
 * Le remplissage de la barre vit dans `lib/search/runs` : c'est une règle, pas
 * une question d'affichage, et elle est testée là-bas.
 */

/** Monte vers `value` en douceur : un compteur qui saute se lit mal. */
function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 400);
      const next = origin + (value - origin) * (1 - (1 - t) ** 3);
      setShown(next);
      from.current = next;
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value]);

  return Math.round(shown);
}

function Counter({ value, label }: { value: number; label: string }) {
  const shown = useCountUp(value);
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-data text-sm font-semibold tabular-nums text-text">{shown}</span>
      <span className="text-[12px] text-muted">{label}</span>
    </span>
  );
}

export function ScanProgress({
  run,
  onStop,
  stopping,
}: {
  run: SearchRun;
  onStop: () => void;
  stopping: boolean;
}) {
  const progress = readProgress(run);
  // Sans plan connu, une barre a peine entamee plutot qu'une barre vide : le
  // scan a bien commence, il n'a simplement pas encore lu de page.
  const ratio = progressRatio(progress);

  return (
    <section className="shadow-mist rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-[15px] font-semibold tracking-tight text-text">Scan en cours</span>
        </span>

        <Counter value={progress.scanned} label="entreprises vérifiées" />
        <Counter value={progress.withSignal} label="signaux" />
        <Counter value={progress.analysed} label="fiches ouvertes" />

        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          loading={stopping}
          onClick={onStop}
        >
          <Square className="h-3.5 w-3.5" aria-hidden />
          Arrêter
        </Button>
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label={progress.step}
      >
        <div
          className="bg-brand-grad h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>

      <p className="mt-2 flex items-center gap-1.5 font-data text-[11px] text-faint" aria-live="polite">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {progress.step}
        {progress.phase === "annuaire" &&
          progress.pagesPlanned > 0 &&
          ` · ${progress.pagesRead}/${progress.pagesPlanned} pages`}
      </p>
    </section>
  );
}
