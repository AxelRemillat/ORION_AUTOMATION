"use client";

import { useState } from "react";
import { ChevronDown, PenLine, RefreshCw } from "lucide-react";
import { Badge, Button, Label, Textarea } from "@/components/ui";
import type { StrategyBrief } from "@/lib/emails/strategist";
import { BriefDetails } from "./brief-details";
import { TargetingWarning } from "./targeting-warning";

const ANGLE_LABELS: Record<StrategyBrief["angle"]["type"], string> = {
  recrutement: "recrutement",
  groupe: "groupe",
  signal: "signal",
  "modèle_éco": "modèle économique",
  "métier": "métier",
};

/**
 * « Angle choisi » — le BRIEF du stratège.
 *
 * L'insight et le pain sont éditables : « Réécrire depuis le brief » relance
 * le rédacteur SEUL sur la version corrigée. « Autre angle » relance le
 * stratège seul, angle actuel exclu. Aucun des deux ne rappelle Linkup,
 * Pappers ou Hunter.
 *
 * Le parent remonte ce composant (prop `key`) à chaque nouveau brief : les
 * champs repartent alors du brief reçu.
 */
export function ChosenAngle({
  brief,
  regenerating,
  onOtherAngle,
  onRewrite,
}: {
  brief: StrategyBrief;
  regenerating: boolean;
  onOtherAngle: () => void;
  onRewrite: (edited: StrategyBrief) => void;
}) {
  const [open, setOpen] = useState(true);
  const [insight, setInsight] = useState(brief.angle.insight);
  const [task, setTask] = useState(brief.pain.task);
  const edited = insight.trim() !== brief.angle.insight || task.trim() !== brief.pain.task;

  function rewrite() {
    onRewrite({
      ...brief,
      angle: { ...brief.angle, insight: insight.trim() },
      pain: { ...brief.pain, task: task.trim() },
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface shadow-mist">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-data text-[11px] font-medium uppercase tracking-wide text-muted">
            Angle choisi
          </span>
          <Badge tone="accent">{ANGLE_LABELS[brief.angle.type]}</Badge>
          {brief.targetingWarning && <Badge tone="warning">ciblage</Badge>}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-line-soft px-5 py-4">
          {brief.targetingWarning && <TargetingWarning message={brief.targetingWarning} />}

          <div>
            <Label htmlFor="brief-insight">Insight</Label>
            <Textarea
              id="brief-insight"
              className="mt-1.5 min-h-[64px] text-[13px]"
              value={insight}
              onChange={(event) => setInsight(event.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="brief-pain">Pain</Label>
            <Textarea
              id="brief-pain"
              className="mt-1.5 min-h-[56px] text-[13px]"
              value={task}
              onChange={(event) => setTask(event.target.value)}
            />
          </div>

          <BriefDetails brief={brief} />

          <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
            <Button
              size="sm"
              variant={edited ? "primary" : "outline"}
              loading={regenerating}
              disabled={insight.trim().length < 15 || task.trim().length < 5}
              onClick={rewrite}
            >
              <PenLine className="h-3.5 w-3.5" aria-hidden />
              Réécrire depuis le brief
            </Button>
            <Button size="sm" variant="outline" loading={regenerating} onClick={onOtherAngle}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Autre angle
            </Button>
            <p className="text-[12px] text-faint">Aucun nouvel appel Linkup, Pappers ou Hunter.</p>
          </div>
        </div>
      )}
    </div>
  );
}
