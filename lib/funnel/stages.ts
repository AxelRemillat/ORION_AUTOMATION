import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SignalCandidateRow } from "@/types";
import { clampDigLimit, contactBadge, digOne, digOrder, type DigDeps } from "./dig";
import { filterSignal } from "./filter";
import { toIdentity, type Lookup } from "./identify";
import type { FunnelPrefs } from "./settings";
import { baseOf, candidatesOf, rowToSignal, updateCandidate } from "./store";
import { triage, type TriageAsk } from "./triage";
import type { Identity, Triage } from "./types";

/**
 * Boucles des étages 2 à 4, sur les lignes d'un run. Dépendances injectées :
 * le job branche l'annuaire, OpenAI et Pappers ; le test branche des doubles.
 * Chaque boucle est idempotente — elle ne reprend que les lignes au bon statut.
 */

type Db = SupabaseClient<Database>;

/** Identités annuaire au plus par run (gratuites, mais limitées en débit). */
export const MAX_LOOKUPS = 250;

const STRENGTH: Record<string, number> = { fort: 3, moyen: 2, faible: 1 };
const strengthOf = (row: SignalCandidateRow) => STRENGTH[String((row.facts as { strength?: string }).strength)] ?? 0;

export interface FilterStageOptions {
  prefs: FunnelPrefs;
  lookup: Lookup;
  /** SIREN déjà en portefeuille, en corbeille ou exclus. */
  known: ReadonlySet<string>;
  now?: Date;
  /** Arrêt propre avant la fin du budget d'une fonction. */
  deadline?: number;
}

export async function runFilterStage(db: Db, userId: string, runId: string, options: FilterStageOptions) {
  const rows = (await candidatesOf(db, userId, runId, "brut")).sort(
    (a, b) => strengthOf(b) - strengthOf(a) || String(b.date_signal).localeCompare(String(a.date_signal)),
  );
  let lookups = 0;
  for (const row of rows) {
    if (options.deadline && Date.now() > options.deadline) break;
    const signal = rowToSignal(row);
    if (signal.siren && options.known.has(signal.siren)) {
      await updateCandidate(db, row.id, { statut: "rejeté", motif_rejet: "déjà en portefeuille, en corbeille ou exclu" });
      continue;
    }
    if (lookups >= MAX_LOOKUPS) {
      await updateCandidate(db, row.id, { statut: "rejeté", motif_rejet: `non examiné : plafond de ${MAX_LOOKUPS} identités atteint` });
      continue;
    }
    lookups += 1;
    const base = await options.lookup(signal);
    const identity = base ? toIdentity(signal, base) : null;
    if (identity?.siren && options.known.has(identity.siren)) {
      await updateCandidate(db, row.id, { statut: "rejeté", motif_rejet: "déjà en portefeuille, en corbeille ou exclu" });
      continue;
    }
    const verdict = filterSignal(signal, identity, {
      preferredSectors: options.prefs.preferredSectors,
      excludedSectors: options.prefs.excludedSectors,
      now: options.now,
    });
    await updateCandidate(db, row.id, {
      statut: verdict.status,
      motif_rejet: verdict.reason,
      weight: verdict.weight,
      badges: verdict.badges,
      siren: identity?.siren || row.siren,
      identity: identity ? { ...identity, legalOnly: verdict.legalOnly, base } : null,
    });
  }
  return { lookups };
}

export async function runTriageStage(db: Db, userId: string, runId: string, ask: TriageAsk) {
  const rows = (await candidatesOf(db, userId, runId, "filtré")).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const inputs = rows.map((row) => {
    const identity = row.identity as unknown as Identity & { legalOnly?: boolean };
    return {
      id: row.id,
      signal: rowToSignal(row),
      identity,
      verdict: { status: "filtré" as const, reason: null, weight: row.weight ?? 0, badges: row.badges, legalOnly: Boolean(identity?.legalOnly) },
    };
  });
  const outcomes = await triage(ask, inputs);
  for (const outcome of outcomes) {
    await updateCandidate(db, outcome.id, {
      statut: outcome.retained ? "retenu" : "rejeté",
      motif_rejet: outcome.reason,
      triage: outcome.triage as unknown as Record<string, unknown> | null,
      score: outcome.triage?.score ?? null,
    });
  }
  return { triaged: outcomes.length, retained: outcomes.filter((outcome) => outcome.retained).length };
}

export interface DigStageOptions {
  deps: DigDeps;
  /** Plafond du run (réglage « fiches à creuser »). */
  limit: number;
  /** Fiches par appel : une étape de job doit tenir dans 300 s. */
  perStep: number;
}

export async function runDigStage(db: Db, userId: string, runId: string, options: DigStageOptions) {
  const all = await candidatesOf(db, userId, runId);
  const budget = clampDigLimit(options.limit) - all.filter((row) => row.statut === "creusé").length;
  const pending = digOrder(
    all
      .filter((row) => row.statut === "retenu" && !row.motif_rejet && row.triage && baseOf(row))
      .map((row) => ({ row, triage: row.triage as unknown as Triage, weight: row.weight ?? 0 })),
  ).slice(0, Math.max(0, Math.min(budget, options.perStep)));

  for (const { row, triage: verdict, weight } of pending) {
    const outcome = await digOne(options.deps, {
      id: row.id,
      signal: rowToSignal(row),
      base: baseOf(row)!,
      triage: verdict,
      weight,
    });
    await updateCandidate(db, row.id, outcome.skipped
      ? { motif_rejet: outcome.skipped }
      : outcome.error
      ? { motif_rejet: `creusage : ${outcome.error}` }
      : {
          statut: "creusé",
          prospect_id: outcome.prospectId,
          publication: outcome.publication,
          contact: { ...(outcome.contact ?? {}), badge: contactBadge(outcome.contact) },
        });
  }
  return { dug: pending.length, remaining: Math.max(0, budget - pending.length) };
}
