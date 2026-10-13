import type { Db } from "@/lib/trash/scope";
import { readAll } from "@/lib/supabase/read-all";

/**
 * COÛT OPENAI D'UNE PRÉPARATION (Cowork #44). `api_usage` ne porte pas l'id du
 * job : on somme ce qui a été consommé depuis le début du job, HORS opérations
 * de rédaction (brouillons écrits en parallèle par les jobs email_generate et
 * par l'agent2 — elles ne sont pas de la préparation).
 */
// `relance` (Cowork #47) : les relances écrites par les autres agents (relance:redaction,
// relance:grille…) comptaient dans le plafond du job de préparation.
export const WRITING_OPERATIONS = /^(qualite|strategie|redaction|reply|relance|opportunites|ping)/;

/** Plafond par défaut d'un job de préparation, en euros (`params.openaiCapEur`). */
export const DEFAULT_PREP_OPENAI_CAP_EUR = 0.5;

export function prepCapOf(params: Record<string, unknown> | null | undefined): number {
  const value = Number(params?.openaiCapEur);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PREP_OPENAI_CAP_EUR;
}

/** Somme des coûts de préparation (hors rédaction) de lignes `api_usage`. Pur. */
export function prepCost(rows: readonly { operation: string | null; cost: number | null }[]): number {
  return rows.reduce((total, row) => (WRITING_OPERATIONS.test(row.operation ?? "") ? total : total + (Number(row.cost) || 0)), 0);
}

/**
 * Coût OpenAI de préparation depuis `since` (début du job) — EXACT.
 *
 * C'est le garde-fou qui arrête une préparation trop chère : il doit tout
 * compter. Un `select` sans pagination s'arrêtait à 1 000 lignes SANS ERREUR
 * (plafond de PostgREST), et le plafond du job sous-estimait alors sa propre
 * dépense (Cowork #23, signalé par #24). Lecture page par page, tri stable.
 *
 * Pourquoi pas une somme côté base : il faudrait recopier en SQL la règle
 * `WRITING_OPERATIONS`, déjà modifiée deux fois (#44, #47). Deux sources pour
 * une même règle finissent par diverger ; le volume d'un job (quelques minutes
 * d'appels) tient d'ordinaire dans une seule page, donc un seul aller-retour.
 */
export async function prepCostSince(db: Db, since: string): Promise<number> {
  const rows = await readAll<{ operation: string | null; cost: number | null }>(
    () => db.from("api_usage").select("id, operation, cost").eq("service", "openai").gte("created_at", since).order("id") as never,
  );
  return prepCost(rows);
}
