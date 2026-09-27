import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import type { FunnelCost } from "./types";

/**
 * Coût d'un run : tout ce que `api_usage` a journalisé pour l'utilisateur
 * depuis son ouverture (tokens OpenAI, crédits Pappers, recherches Hunter et
 * Linkup). Deux runs simultanés du même compte se confondraient : sans effet
 * tant que l'app est mono-utilisateur et qu'un run tourne à la fois.
 */
export async function runCost(
  db: SupabaseClient<Database>,
  userId: string,
  since: string,
): Promise<FunnelCost> {
  const { data } = await db
    .from("api_usage")
    .select("service, units, cost")
    .eq("user_id", userId)
    .gte("created_at", since);

  const cost: FunnelCost = { eur: 0, tokens: 0, pappers: 0, hunter: 0, linkup: 0 };
  for (const row of data ?? []) {
    cost.eur += Number(row.cost) || 0;
    if (row.service === "openai") cost.tokens += Number(row.units) || 0;
    if (row.service === "pappers") cost.pappers += Number(row.units) || 0;
    if (row.service === "hunter") cost.hunter += Number(row.units) || 0;
    if (row.service === "linkup") cost.linkup += Number(row.units) || 0;
  }
  cost.eur = Number(cost.eur.toFixed(4));
  return cost;
}
