import { createAdminClient, createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/supabase/read-all";
import {
  openAiBudgetState,
  openAiMonthlyCap,
  pappersDailyBudget,
  pappersGate,
  parisDayStart,
  parisMonthStart,
  type OpenAiBudgetState,
  type PappersGate,
} from "./budgets";

/**
 * Compteurs réels des plafonds, lus dans `api_usage` (page par page : au-delà
 * de 1 000 lignes, PostgREST tronque en silence). SERVEUR UNIQUEMENT.
 */

type Reader = { from: (table: string) => any };

/** Même règle que la journalisation (lib/usage/record.ts) : service_role hors requête. */
const defaultDb = (): Reader => (process.env.ORION_SCRIPT_USER_ID ? createAdminClient() : createClient()) as unknown as Reader;

async function sumSince(db: Reader, service: string, since: Date, column: "units" | "cost"): Promise<number> {
  const rows = await readAll<Record<string, unknown>>(() =>
    db.from("api_usage").select(`id, ${column}`).eq("service", service).gte("created_at", since.toISOString()).order("id"),
  );
  return rows.reduce((total, row) => total + (Number(row[column]) || 0), 0);
}

/** Feu vert Pappers pour un appel. Une panne du compteur ne bloque pas (on compte 0). */
export async function pappersAllowance(options: { db?: Reader; now?: Date; env?: Record<string, string | undefined> } = {}): Promise<PappersGate> {
  const used = await sumSince(options.db ?? defaultDb(), "pappers", parisDayStart(options.now), "units").catch(() => 0);
  return pappersGate(Math.round(used), pappersDailyBudget(options.env));
}

/** Dépense OpenAI du mois (Paris) et niveau du plafond. */
export async function openAiBudget(options: { db?: Reader; now?: Date; env?: Record<string, string | undefined> } = {}): Promise<OpenAiBudgetState> {
  const spent = await sumSince(options.db ?? defaultDb(), "openai", parisMonthStart(options.now), "cost").catch(() => 0);
  return openAiBudgetState(spent, openAiMonthlyCap(options.env));
}
