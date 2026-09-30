import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SignalCandidateRow } from "@/types";
import { examinationPlan } from "./budget";
import { clampDigLimit, contactBadge, digOne, digOrder, type DigDeps } from "./dig";
import { filterSignal, NO_PAIN_TITLE } from "./filter";
import { painForJob } from "./pain-map";
import { toIdentity, type Lookup } from "./identify";
import type { FunnelPrefs } from "./settings";
import {
  baseOf,
  candidatesOf,
  NOT_EXAMINED,
  pendingDigOf,
  rowToSignal,
  updateCandidate,
  updateCandidates,
} from "./store";
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

/** Motif d'un signal laissé hors du budget d'examen. */
export const notExaminedReason = (cap: number) => `${NOT_EXAMINED} : plafond de ${cap} signaux examinés par run (quota par source)`;

/** Un signal a consommé une identité annuaire : il n'est plus brut, ou il attend d'être rejoué. */
const examined = (row: SignalCandidateRow) =>
  (row.statut !== "brut" &&
    !(row.motif_rejet ?? "").startsWith(NOT_EXAMINED) &&
    !/^déjà en portefeuille/.test(row.motif_rejet ?? "") &&
    row.motif_rejet !== NO_PAIN_TITLE) ||
  (row.statut === "brut" && /^annuaire saturé/.test(row.motif_rejet ?? ""));

export interface FilterStageOptions {
  prefs: FunnelPrefs;
  lookup: Lookup;
  /** SIREN déjà en portefeuille, en corbeille ou exclus. */
  known: ReadonlySet<string>;
  now?: Date;
  /** Arrêt propre avant la fin du budget d'une fonction. */
  deadline?: number;
  /** Plafond d'identités du run (défaut MAX_LOOKUPS). */
  cap?: number;
}

/**
 * ÉTAGE 2. Découpé en plusieurs étapes de job (240 s chacune) : le 30/09, une
 * seule étape s'arrêtait après 263 signaux sur 2 653, et le reste restait
 * « brut » pour toujours. Le budget d'examen est fixé au PREMIER passage
 * (quota par source, cf. budget.ts) ; les passages suivants finissent le travail.
 */
export async function runFilterStage(db: Db, userId: string, runId: string, options: FilterStageOptions) {
  const cap = options.cap ?? MAX_LOOKUPS;
  const all = await candidatesOf(db, userId, runId);
  let pending = all.filter((row) => row.statut === "brut");

  // Déjà connus : écartés sans consommer d'identité.
  const known = pending.filter((row) => row.siren && options.known.has(row.siren));
  if (known.length) {
    await updateCandidates(db, known.map((row) => row.id), { statut: "rejeté", motif_rejet: "déjà en portefeuille, en corbeille ou exclu" });
    pending = pending.filter((row) => !known.includes(row));
  }

  // Offres dont l'intitulé ne révèle aucun pain : écartées GRATUITEMENT, avant
  // le budget. Le 30/09, 54 des 125 offres examinées (ingénieurs, développeurs…)
  // avaient consommé une identité annuaire pour finir sur ce même motif.
  const noPain = pending.filter(
    (row) => row.source === "france-travail" && !row.motif_rejet && !painForJob(rowToSignal(row).facts.jobTitle ?? row.texte_brut),
  );
  if (noPain.length) {
    await updateCandidates(db, noPain.map((row) => row.id), { statut: "rejeté", motif_rejet: NO_PAIN_TITLE });
    pending = pending.filter((row) => !noPain.includes(row));
  }

  // Budget : ce qui reste du plafond du run, réparti par source.
  const budget = Math.max(0, cap - all.filter(examined).length);
  const fresh = pending.filter((row) => !row.motif_rejet);
  const replay = pending.filter((row) => row.motif_rejet); // annuaire saturé : prioritaire
  const plan = examinationPlan(
    fresh.map((row) => ({ id: row.id, source: row.source, date: String(row.date_signal ?? ""), strength: strengthOf(row), row })),
    Math.max(0, budget - replay.length),
  );
  if (plan.skip.length) {
    await updateCandidates(db, plan.skip.map((item) => item.id), { statut: "rejeté", motif_rejet: notExaminedReason(cap) });
  }

  let lookups = 0;
  for (const row of [...replay, ...plan.examine.map((item) => item.row)]) {
    if (options.deadline && Date.now() > options.deadline) break;
    const signal = rowToSignal(row);
    lookups += 1;
    const found = await options.lookup(signal);
    // Annuaire saturé : le signal n'est PAS faux, il n'a pas pu être identifié.
    // On le laisse « à rejouer » plutôt que de le classer introuvable.
    if (!found.ok) {
      await updateCandidate(db, row.id, { motif_rejet: "annuaire saturé : identité non vérifiée, à rejouer" });
      continue;
    }
    const identity = found.company ? toIdentity(signal, found.company) : null;
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
      identity: identity ? { ...identity, legalOnly: verdict.legalOnly, base: found.company } : null,
    });
  }
  const remaining = (await candidatesOf(db, userId, runId, "brut")).length;
  return { lookups, remaining, bySource: plan.bySource };
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
  const badgesOf = new Map(rows.map((row) => [row.id, row.badges ?? []]));
  for (const outcome of outcomes) {
    await updateCandidate(db, outcome.id, {
      statut: outcome.retained ? "retenu" : "rejeté",
      // Un retenu n'a JAMAIS de motif : le creusage ne prend que les fiches sans motif.
      motif_rejet: outcome.retained ? null : outcome.reason,
      triage: outcome.triage as unknown as Record<string, unknown> | null,
      score: outcome.triage?.score ?? null,
      ...(outcome.note ? { badges: [...(badgesOf.get(outcome.id) ?? []), outcome.note] } : {}),
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
  prefs?: Pick<FunnelPrefs, "preferredSectors" | "excludedSectors">;
  now?: Date;
}

/**
 * ÉTAGE 4. Creuse les retenus du run, PUIS ceux qu'un run précédent a laissés
 * en attente (repris dans ce run). Un retenu d'un ancien run repasse d'abord le
 * filtre avec les règles ACTUELLES : les règles ont pu changer depuis.
 *
 * Issue de chaque fiche, toujours explicite :
 *   - creusée               → statut « creusé » ;
 *   - écartée au creusage   → statut « rejeté », motif « creusage : … »
 *     (opposition, aucun salarié…) — ce n'est PAS une fiche en attente ;
 *   - erreur passagère      → reste « retenu », motif « creusage à reprendre : … »,
 *     reprise au run suivant.
 */
export async function runDigStage(db: Db, userId: string, runId: string, options: DigStageOptions) {
  const all = await candidatesOf(db, userId, runId);
  const budget = clampDigLimit(options.limit) - all.filter((row) => row.statut === "creusé").length;

  const eligible = (row: SignalCandidateRow) => row.statut === "retenu" && !row.motif_rejet && row.triage && baseOf(row);
  // D'un run précédent : aussi les erreurs passagères (jamais retentées dans le même run).
  const retryable = (row: SignalCandidateRow) => !row.motif_rejet || row.motif_rejet.startsWith("creusage à reprendre");
  const current = all.filter(eligible);
  const earlier = (await pendingDigOf(db, userId)).filter(
    (row) => row.run_id !== runId && row.statut === "retenu" && retryable(row) && row.triage && baseOf(row),
  );

  // Anciens retenus : re-filtrés avec les règles actuelles avant de coûter un creusage.
  const resumed: SignalCandidateRow[] = [];
  for (const row of earlier) {
    const identity = row.identity as unknown as Identity | null;
    const verdict = filterSignal(rowToSignal(row), identity, { ...options.prefs, now: options.now });
    if (verdict.status === "rejeté") {
      await updateCandidate(db, row.id, { statut: "rejeté", motif_rejet: `re-filtré : ${verdict.reason}` });
      continue;
    }
    resumed.push(row);
  }

  const pending = [
    ...digOrder(current.map((row) => ({ row, triage: row.triage as unknown as Triage, weight: row.weight ?? 0 }))),
    ...digOrder(resumed.map((row) => ({ row, triage: row.triage as unknown as Triage, weight: row.weight ?? 0 }))),
  ].slice(0, Math.max(0, Math.min(budget, options.perStep)));

  for (const { row, triage: verdict, weight } of pending) {
    // Une fiche reprise d'un run précédent rejoint ce run : elle y est comptée.
    if (row.run_id !== runId) await updateCandidate(db, row.id, { run_id: runId, motif_rejet: null });
    const outcome = await digOne(options.deps, {
      id: row.id,
      signal: rowToSignal(row),
      base: baseOf(row)!,
      triage: verdict,
      weight,
    });
    await updateCandidate(
      db,
      row.id,
      outcome.skipped
        ? { statut: "rejeté", motif_rejet: `creusage : ${outcome.skipped}` }
        : outcome.error
        ? outcome.error === "déjà en portefeuille"
          ? { statut: "rejeté", motif_rejet: "creusage : déjà en portefeuille" }
          : { motif_rejet: `creusage à reprendre : ${outcome.error}` }
        : {
            statut: "creusé",
            prospect_id: outcome.prospectId,
            publication: outcome.publication,
            contact: { ...(outcome.contact ?? {}), badge: contactBadge(outcome.contact) },
          },
    );
  }
  return { dug: pending.length, resumed: resumed.length, remaining: Math.max(0, budget - pending.length) };
}
