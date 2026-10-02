import type { JobHandler, StepContext } from "../runner";
import type { JobType } from "../types";
import { emailHandler } from "./email";
import { reanalyzeHandler } from "./reanalyze";
import { searchCriteriaHandler } from "./search";
import { searchSignalsHandler } from "./signals";
import { FUNNEL_KIND, signalFunnelHandler } from "./funnel";
import { PREPARE_KIND, prepareHandler } from "./prepare";

/**
 * Aiguillage de `search_signals` : l'entonnoir « signaux d'abord » en est une
 * variante (`params.kind = "funnel"`). Il ne peut pas avoir son propre type :
 * la contrainte `jobs_type_check` le refuserait, et la modifier serait un
 * ALTER sur une table existante. Chaque étape délègue au bon exécuteur ; la
 * dernière étape du plus court des deux termine le job (`done`).
 */
export function byKind(base: JobHandler, variants: Record<string, JobHandler>): JobHandler {
  const pick = (ctx: StepContext) => variants[String(ctx.job.params.kind ?? "")] ?? base;
  const length = Math.max(base.steps.length, ...Object.values(variants).map((handler) => handler.steps.length));
  return {
    steps: Array.from({ length }, (_, index) => async (ctx: StepContext) => {
      const handler = pick(ctx);
      const step = handler.steps[index];
      if (!step) return { done: true };
      const outcome = await step(ctx);
      return index === handler.steps.length - 1 ? { ...outcome, done: true } : outcome;
    }),
    onFailed: (ctx, message) => pick(ctx).onFailed?.(ctx, message) ?? Promise.resolve(),
  };
}

/** Un exécuteur par type de job. */
export const HANDLERS: Record<JobType, JobHandler> = {
  search_criteria: searchCriteriaHandler,
  search_signals: byKind(searchSignalsHandler, { [FUNNEL_KIND]: signalFunnelHandler, [PREPARE_KIND]: prepareHandler }),
  email_generate: emailHandler,
  email_rewrite: emailHandler,
  reanalyze: reanalyzeHandler,
};
