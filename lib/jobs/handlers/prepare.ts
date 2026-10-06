import { autoReplyKind } from "@/lib/inbound/auto-reply";
import { verifyOpposition } from "@/lib/enrichment/opposition";
import { openAiBudget, pappersAllowance } from "@/lib/usage/budgets-server";
import { candidatesOf } from "@/lib/funnel/store";
import type { OpenAiBudgetState } from "@/lib/usage/budgets";
import { liveDigDeps } from "@/lib/funnel/live";
import { verifyQueueOppositions } from "@/lib/today/opposition";
import { verifyFollowUpOppositions } from "@/lib/outbox/opposition-backfill";
import { ensureBusinessProfile, profileAsk } from "../business-profile";
import { ensureFacts } from "@/lib/enrichment/facts-server";
import { draftFollowUp } from "@/lib/outbox/follow-up";
import { draftReply } from "@/lib/outbox/reply-generate";
import { runCompletionStage } from "@/lib/today/complete";
import { liveCompletionDeps } from "@/lib/today/complete-live";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import { needsIntroDraft } from "@/lib/today/tags";
import type { InboundMessage, Prospect } from "@/types";
import { createJob } from "../store";
import { EMPTY_PROGRESS } from "../types";
import type { JobHandler, StepContext, StepOutcome } from "../runner";
import { digStep, FILTER_STEPS, filterStep, finishStep, harvestStep, prefsOf, SITE_STEPS, siteStep, STEP_BUDGET_MS, TRIAGE_STEPS, triageStep } from "./funnel";
import { closeRunOnFailure, prepareRun, runIdOf } from "./search-shared";

/** Variante de `search_signals` qui prépare « Aujourd'hui » (voir handlers/index.ts). */
export const PREPARE_KIND = "prepare";

/**
 * Job `search_signals` + `params.kind = "prepare"` — la préparation du matin.
 *
 *   opposition des fiches en attente jamais vérifiée (INPI, puis Pappers)
 *   → entonnoir (moisson → filtre ×8 → tri → creusage ×8)
 *   → complétion des fiches « à compléter » (une tentative par run, 3 au plus)
 *   → profil métier des fiches dont le site existe mais n'a pas été lu
 *   → faits distinctifs sourcés (key_figures.facts, lib/enrichment/facts.ts)
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
/** Vérifications d'opposition par run : l'INPI est gratuit, le temps d'étape est compté. */
const OPPOSITIONS_PER_RUN = 40;
/** Profils métier lus par run : un appel LLM léger chacun. */
const PROFILES_PER_RUN = 12;
/** Faits distinctifs : trois étapes de 240 s, un appel LLM léger par fiche. */
const FACTS_STEPS = 3;
const FACTS_PER_STEP = 10;

const progress = (step: string, pct: number) => ({ step, pct, counts: { scanned: 0, signals: 0, sheets: 0 } });
const deadline = () => Date.now() + STEP_BUDGET_MS;

async function completeStep(ctx: StepContext): Promise<StepOutcome> {
  const runId = runIdOf(ctx);
  const prefs = await prefsOf(ctx);
  // Site d'abord (URL connues → domaines → Linkup plafonné), email, profil,
  // « Non joignable » après trois tentatives (lib/today/complete-live.ts).
  const report = await runCompletionStage(ctx.db, ctx.userId, runId, {
    deps: liveCompletionDeps(ctx.db, ctx.userId, runId),
    prefs,
    limit: COMPLETE_PER_STEP,
    deadline: deadline(),
  });
  return { progress: progress(`Complétion : ${report.found} email(s) trouvé(s) sur ${report.tried} fiche(s)`, 96) };
}

/**
 * Opposition à la prospection des fiches en attente qui n'ont jamais été
 * vérifiées (ADJUVOO, 02/10/2026) : AVANT tout le reste, pour qu'aucune
 * complétion ni aucun brouillon ne soit dépensé sur une fiche opposée.
 */
async function oppositionStep(ctx: StepContext): Promise<StepOutcome> {
  const report = await verifyQueueOppositions(ctx.db, ctx.userId, {
    verify: (siren) => verifyOpposition(siren, "inpi-first"),
    limit: OPPOSITIONS_PER_RUN,
    deadline: deadline(),
  });
  return {
    progress: progress(
      `Opposition : ${report.checked} fiche(s) vérifiée(s), ${report.opposed} opposée(s) écartée(s)${report.failed ? `, ${report.failed} sans réponse` : ""}`,
      2,
    ),
  };
}

/**
 * Opposition des prospects DÉJÀ CONTACTÉS dont une relance est possible :
 * vérifiée AVANT l'étape des relances (une relance non vérifiée est bloquée).
 */
async function followUpOppositionStep(ctx: StepContext): Promise<StepOutcome> {
  const report = await verifyFollowUpOppositions(ctx.db, ctx.userId, {
    verify: (siren) => verifyOpposition(siren, "inpi-first"),
    limit: OPPOSITIONS_PER_RUN,
    deadline: deadline(),
  });
  return {
    progress: progress(
      `Opposition (relances) : ${report.checked} vérifiée(s), ${report.opposed} opposée(s)${report.failed ? `, ${report.failed} sans réponse` : ""}`,
      3,
    ),
  };
}

/**
 * Profil métier des fiches de la file dont le site existe mais n'a jamais été
 * lu — les fiches DÉJÀ là comprises, pas seulement les nouvelles. Le brouillon
 * qui suit s'appuie dessus.
 */
async function profilesStep(ctx: StepContext): Promise<StepOutcome> {
  const end = deadline();
  const items = flatten((await loadToday(ctx.db, ctx.userId)).groups).filter(
    (item) => item.messageType === "intro" && item.prospectId && item.website && item.tags.includes("Profil à compléter"),
  );
  let read = 0;
  let failed = 0;
  for (const item of items.slice(0, PROFILES_PER_RUN)) {
    if (Date.now() > end) break;
    const { data } = await ctx.db.from("prospects").select("*").eq("id", item.prospectId!).maybeSingle();
    if (!data) continue;
    const run = await ensureBusinessProfile(ctx.db, data as Prospect, profileAsk(item.prospectId!)).catch(() => null);
    if (run?.profile) read += 1;
    else {
      failed += 1;
      const figures = ((data as Prospect).key_figures ?? {}) as Record<string, unknown>;
      await ctx.db
        .from("prospects")
        .update({ key_figures: { ...figures, profile_failed_at: new Date().toISOString() } })
        .eq("id", item.prospectId!)
        .eq("user_id", ctx.userId);
    }
  }
  return { progress: progress(`Profil métier : ${read} lu(s)${failed ? `, ${failed} illisible(s)` : ""}`, 96) };
}

/**
 * FAITS DISTINCTIFS SOURCÉS (Cowork #34) des fiches de la file qui ont un site
 * et pas encore de faits : le brouillon qui suit s'appuie dessus. Les fiches
 * contactées n'y sont pas (elles ne sont plus en intro).
 */
async function factsStep(ctx: StepContext): Promise<StepOutcome> {
  const end = deadline();
  const items = flatten((await loadToday(ctx.db, ctx.userId)).groups).filter(
    (item) => item.messageType === "intro" && item.prospectId && item.website && item.status === "todo",
  );
  let read = 0;
  let found = 0;
  for (const item of items) {
    if (read >= FACTS_PER_STEP || Date.now() > end) break;
    const { data } = await ctx.db.from("prospects").select("id, company_name, website, key_figures").eq("id", item.prospectId!).maybeSingle();
    const prospect = data as { id: string; company_name: string; website: string | null; key_figures: Record<string, unknown> | null } | null;
    if (!prospect || Array.isArray(prospect.key_figures?.facts)) continue;
    const run = await ensureFacts(ctx.db, prospect).catch(() => null);
    read += 1;
    if (run?.facts.length) found += 1;
  }
  return { progress: progress(`Faits distinctifs : ${found} fiche(s) sur ${read} lue(s)`, 97) };
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
    if (autoReplyKind(inbound)) continue; // anti-spam, absence : pas de réponse IA
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

/** Ré-exporté : la règle vit dans lib/today/tags.ts (aussi utilisée hors préparation). */
export { needsIntroDraft };

async function draftsStep(ctx: StepContext): Promise<StepOutcome> {
  // Préparation « sans brouillons » (lot de mesure, Cowork #34) : on s'arrête
  // avant la génération des mails.
  if (ctx.job.params?.skipDrafts === true) return { progress: { ...EMPTY_PROGRESS, step: "Brouillons non lancés (préparation sans brouillons)", pct: 99 } };
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
        params: { prospectId: item.prospectId!, mode: "full", saveDraft: true, storedContact: true, auto: true },
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

/**
 * OBJECTIF DU JOUR (« Mails prêts visés par jour », défaut 15) : au lieu d'un
 * nombre fixe de fiches creusées, la préparation ÉLARGIT l'entonnoir une fois
 * si l'objectif n'est pas atteint — fenêtre doublée (30 jours max), toute la
 * France — tant que les budgets le permettent (plafond OpenAI du mois, plafond
 * Pappers du jour). Un seul élargissement par préparation.
 */
const WIDEN_DIG_STEPS = 4;

export function widenPlan(input: { ready: number; target: number; days: number; departements: string[]; budgetOk: boolean; alreadyWidened: boolean }):
  | { widen: false; reason: string }
  | { widen: true; days: number; departements: string[]; digLimit: number; reason: string } {
  if (input.ready >= input.target) return { widen: false, reason: `objectif atteint (${input.ready}/${input.target} prêts)` };
  if (input.alreadyWidened) return { widen: false, reason: `objectif non atteint après élargissement (${input.ready}/${input.target})` };
  if (!input.budgetOk) return { widen: false, reason: `objectif non atteint (${input.ready}/${input.target}) : budget du jour atteint, pas d'élargissement` };
  const missing = input.target - input.ready;
  const days = Math.min(30, Math.max(input.days * 2, input.days + 7));
  return {
    widen: true,
    days,
    departements: [],
    digLimit: Math.min(30, input.target + missing),
    reason: `objectif non atteint (${input.ready}/${input.target}) : entonnoir élargi à ${days} jours, toute la France`,
  };
}

async function widenStep(ctx: StepContext): Promise<StepOutcome> {
  const prefs = await prefsOf(ctx);
  const runId = runIdOf(ctx);
  const ready = (await candidatesOf(ctx.db, ctx.userId, runId)).filter((row) => row.statut === "creusé" && row.publication === "pret").length;
  const [openai, pappers] = await Promise.all([openAiBudget().catch(() => null), pappersAllowance().catch(() => null)]);
  const plan = widenPlan({
    ready,
    target: prefs.dailyTarget,
    days: prefs.days,
    departements: prefs.departements,
    budgetOk: openai?.level !== "plafond" && pappers?.allowed !== false,
    alreadyWidened: Boolean(ctx.job.state.widen),
  });
  if (!plan.widen) return { progress: progress(plan.reason, 80) };
  return { state: { widen: { days: plan.days, departements: plan.departements, digLimit: plan.digLimit } }, progress: progress(plan.reason, 80) };
}

/** Étape du second tour : ne tourne que si l'entonnoir a été élargi. */
const whenWidened = (step: Step): Step => async (ctx) => (ctx.job.state.widen ? step(ctx) : {});

/**
 * PLAFOND OPENAI (OPENAI_MONTHLY_BUDGET_EUR, défaut 15 €) : vérifié avant chaque
 * étape qui peut en consommer. Atteint, la préparation s'ARRÊTE PROPREMENT :
 * le run de l'entonnoir est clos (bilan), les brouillons déjà faits restent,
 * et le motif devient l'avancement du job — c'est ce que « Lancer maintenant »
 * et l'en-tête d'« Aujourd'hui » affichent.
 */
type Step = (ctx: StepContext) => Promise<StepOutcome>;

export function openAiGuarded(step: Step, budget: () => Promise<OpenAiBudgetState> = () => openAiBudget()): Step {
  return async (ctx) => {
    const state = await budget().catch(() => null);
    if (state?.level !== "plafond") return step(ctx);
    const closed = await finishStep(ctx).catch(() => ({}) as StepOutcome);
    return { ...closed, done: true, progress: progress(state.message ?? "Plafond OpenAI atteint : préparation arrêtée.", 100) };
  };
}

export const prepareHandler: JobHandler = {
  steps: [
    prepareRun,
    oppositionStep,
    followUpOppositionStep,
    harvestStep,
    ...Array.from({ length: FILTER_STEPS }, (_, i) => filterStep(i)),
    // Le tri juste après le filtre (étape 14) : un job en cours y reprend.
    ...Array.from({ length: TRIAGE_STEPS }, (_, i) => openAiGuarded(triageStep(i))),
    // Trois étapes de 240 s : ~40 retenus par run (France Travail élargi, 05/10/2026).
    ...Array.from({ length: SITE_STEPS }, () => siteStep),
    ...Array.from({ length: DIG_STEPS }, (_, i) => openAiGuarded(digStep(i, DIG_STEPS))),
    // Objectif du jour : un second tour élargi si besoin (sinon ces étapes ne font rien).
    widenStep,
    whenWidened(harvestStep),
    ...Array.from({ length: FILTER_STEPS }, (_, i) => whenWidened(filterStep(i))),
    ...Array.from({ length: TRIAGE_STEPS }, (_, i) => whenWidened(openAiGuarded(triageStep(i)))),
    whenWidened(siteStep),
    ...Array.from({ length: WIDEN_DIG_STEPS }, (_, i) => whenWidened(openAiGuarded(digStep(i, WIDEN_DIG_STEPS)))),
    openAiGuarded(completeStep),
    openAiGuarded(profilesStep),
    ...Array.from({ length: FACTS_STEPS }, () => openAiGuarded(factsStep)),
    openAiGuarded(repliesStep),
    openAiGuarded(relancesStep),
    openAiGuarded(draftsStep),
    summaryStep,
  ],
  onFailed: closeRunOnFailure,
};
