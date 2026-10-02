import { liveDigDeps } from "@/lib/funnel/live";
import { draftFollowUp } from "@/lib/outbox/follow-up";
import { draftReply } from "@/lib/outbox/reply-generate";
import { runCompletionStage } from "@/lib/today/complete";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import { BLOCKING_TAGS, type TodayItem } from "@/lib/today/types";
import type { InboundMessage, Prospect } from "@/types";
import { createJob } from "../store";
import { EMPTY_PROGRESS } from "../types";
import type { JobHandler, StepContext, StepOutcome } from "../runner";
import { digStep, FILTER_STEPS, filterStep, finishStep, harvestStep, prefsOf, STEP_BUDGET_MS, triageStep } from "./funnel";
import { closeRunOnFailure, prepareRun, runIdOf } from "./search-shared";

/** Variante de `search_signals` qui prépare « Aujourd'hui » (voir handlers/index.ts). */
export const PREPARE_KIND = "prepare";

/**
 * Job `search_signals` + `params.kind = "prepare"` — la préparation du matin.
 *
 *   entonnoir (moisson → filtre ×8 → tri → creusage ×8)
 *   → complétion des fiches « à compléter » (une tentative par run, 3 au plus)
 *   → brouillons de réponse aux mails reçus
 *   → relances J+4 / J+7 dues, dans le fil de l'envoi précédent
 *   → brouillons d'intro (jobs `email_generate`, contact de la fiche réutilisé)
 *   → bilan
 *
 * RIEN n'est envoyé : tout finit en brouillon, à valider dans « Aujourd'hui ».
 * Chaque étape tient dans 240 s et ne reprend que ce qui reste à faire.
 */

const DIG_STEPS = 8; // 8 × 4 = 32 fiches au plus, au-delà de l'objectif de 25.
const COMPLETE_PER_STEP = 6;

const progress = (step: string, pct: number) => ({ step, pct, counts: { scanned: 0, signals: 0, sheets: 0 } });
const deadline = () => Date.now() + STEP_BUDGET_MS;

async function completeStep(ctx: StepContext): Promise<StepOutcome> {
  const runId = runIdOf(ctx);
  const prefs = await prefsOf(ctx);
  const deps = liveDigDeps(ctx.db, ctx.userId, runId);
  const report = await runCompletionStage(ctx.db, ctx.userId, runId, {
    deps: { findContact: deps.findContact, hunterBlocked: deps.hunterBlocked },
    prefs,
    limit: COMPLETE_PER_STEP,
    deadline: deadline(),
  });
  return { progress: progress(`Complétion : ${report.found} email(s) trouvé(s) sur ${report.tried} fiche(s)`, 96) };
}

async function repliesStep(ctx: StepContext): Promise<StepOutcome> {
  const end = deadline();
  const { data } = await ctx.db
    .from("inbound_messages")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("handled", false)
    .is("deleted_at", null)
    .not("prospect_id", "is", null)
    .order("received_at", { ascending: true })
    .limit(20);
  let written = 0;
  for (const inbound of (data ?? []) as InboundMessage[]) {
    if (Date.now() > end) break;
    const outcome = await draftReply(ctx.db, { userId: ctx.userId, inbound }).catch(() => null);
    if (outcome?.ok && !("existing" in outcome)) written += 1;
  }
  return { progress: progress(`${written} brouillon(s) de réponse`, 97) };
}

/** Relances dues sans brouillon : celles que « Aujourd'hui » affiche « Brouillon manquant ». */
async function relancesStep(ctx: StepContext): Promise<StepOutcome> {
  const end = deadline();
  const { groups } = await loadToday(ctx.db, ctx.userId);
  const missing = flatten(groups).filter((item) => item.kind === "relance" && item.status === "todo" && !item.messageId && item.prospectId && item.followUpType);
  let written = 0;
  for (const item of missing) {
    if (Date.now() > end) break;
    const { data } = await ctx.db.from("prospects").select("*").eq("id", item.prospectId!).maybeSingle();
    if (!data) continue;
    const outcome = await draftFollowUp(ctx.db, { userId: ctx.userId, prospect: data as Prospect, type: item.followUpType! }).catch(() => null);
    if (outcome?.ok) written += 1;
  }
  return { progress: progress(`${written} relance(s) rédigée(s), dans le même fil`, 98) };
}

/** Fiche qui n'attend plus que son brouillon : contact sûr, opposition vérifiée. */
export const needsIntroDraft = (item: TodayItem) =>
  item.messageType === "intro" &&
  item.status === "todo" &&
  !item.messageId &&
  !item.draftPending &&
  Boolean(item.contact.email) &&
  item.tags.includes("Brouillon manquant") &&
  !item.tags.some((tag) => tag !== "Brouillon manquant" && BLOCKING_TAGS.has(tag));

async function draftsStep(ctx: StepContext): Promise<StepOutcome> {
  const prefs = await prefsOf(ctx);
  const items = flatten((await loadToday(ctx.db, ctx.userId)).groups);
  const ready = items.filter((item) => item.kind === "nouveau" && item.status === "todo").length;
  const pending = items.filter((item) => item.messageType === "intro" && item.draftPending).length;
  const room = Math.max(0, prefs.dailyTarget - ready - pending);
  const todo = items.filter(needsIntroDraft).slice(0, room);
  for (const item of todo) {
    // Un job par mail : il tourne à côté, reprenable, avec son propre budget de temps.
    await createJob(
      ctx.db,
      {
        type: "email_generate",
        target: { prospectId: item.prospectId!, label: `Mail ${item.companyName}` },
        params: { prospectId: item.prospectId!, mode: "full", saveDraft: true, storedContact: true, origin: PREPARE_KIND },
      },
      ctx.userId,
    );
  }
  return { progress: { ...EMPTY_PROGRESS, step: `${todo.length} brouillon(s) d'intro en préparation`, pct: 99 } };
}

/** Bilan : le run de l'entonnoir est clos, l'avancement dit ce qui attend Axel. */
async function summaryStep(ctx: StepContext): Promise<StepOutcome> {
  const outcome = await finishStep(ctx);
  const { groups } = await loadToday(ctx.db, ctx.userId);
  const count = (kind: string) => groups.find((group) => group.kind === kind)?.items.length ?? 0;
  return {
    ...outcome,
    progress: progress(
      `Préparé : ${count("reponse")} réponse(s), ${count("relance")} relance(s), ${count("nouveau")} nouveau(x), ${count("a_completer")} à compléter`,
      100,
    ),
  };
}

export const prepareHandler: JobHandler = {
  steps: [
    prepareRun,
    harvestStep,
    ...Array.from({ length: FILTER_STEPS }, (_, i) => filterStep(i)),
    triageStep,
    ...Array.from({ length: DIG_STEPS }, (_, i) => digStep(i, DIG_STEPS)),
    completeStep,
    repliesStep,
    relancesStep,
    draftsStep,
    summaryStep,
  ],
  onFailed: closeRunOnFailure,
};
