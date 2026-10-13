import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { ApiService } from "@/types";
import { openAiCost, serviceUnit } from "./pricing";

/**
 * Journalisation de la consommation des APIs tierces.
 *
 * Regle : mesurer ne doit jamais casser la fonctionnalite mesuree. Un echec
 * d'ecriture est avale — on prefere perdre une ligne de comptabilite que de
 * faire echouer un enrichissement. En contrepartie, l'ecran Couts indique
 * qu'il reflete ce que l'app a enregistre, pas la facture du fournisseur.
 *
 * Module serveur : il depend de `next/headers` via le client Supabase, donc
 * toute tentative de l'importer depuis un composant client echoue au build.
 *
 * HORS REQUETE (scripts de maintenance, re-enrichissement) il n'y a ni cookie
 * ni session : `auth.uid()` est nul et l'insertion echouerait en silence, ce
 * qui rendait le cout des traitements par lot invisible. Quand
 * ORION_SCRIPT_USER_ID est defini, on passe donc par la cle service_role en
 * fournissant explicitement le proprietaire de la ligne.
 */

interface UsageEntry {
  service: ApiService;
  operation: string;
  units: number;
  unitCost: number;
  cost: number;
  prospectId?: string | null;
}

/**
 * QUI consomme (Cowork #38) : `USAGE_SOURCE` (agent1…agent4, prod, cron),
 * « prod » par défaut. Une valeur inattendue est gardée telle quelle, bornée.
 */
export function usageSource(env: Record<string, string | undefined> = process.env): string {
  const raw = env.USAGE_SOURCE?.trim().toLowerCase();
  return raw ? raw.replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "prod" : "prod";
}

async function insert(entry: UsageEntry): Promise<void> {
  const scriptUserId = process.env.ORION_SCRIPT_USER_ID;
  try {
    const supabase = scriptUserId ? createAdminClient() : createClient();
    const row = {
      service: entry.service,
      operation: entry.operation,
      units: Number(entry.units.toFixed(4)),
      unit_cost: Number(entry.unitCost.toFixed(6)),
      cost: Number(entry.cost.toFixed(6)),
      prospect_id: entry.prospectId ?? null,
      ...(scriptUserId ? { user_id: scriptUserId } : {}),
    };
    const { error } = await supabase.from("api_usage").insert({ ...row, source: usageSource() } as never);
    // Base pas encore migrée (colonne `source` absente) : la ligne est gardée sans source.
    if (error && /source/i.test(error.message)) await supabase.from("api_usage").insert(row);
  } catch {
    // Hors contexte de requete (script, tache de fond) ou base indisponible :
    // on ne journalise pas, et surtout on ne propage pas.
  }
}

/**
 * Un appel OpenAI. `usage` vient de la reponse de l'API : le cout est donc
 * calcule sur les tokens REELLEMENT factures, pas sur une estimation.
 */
export async function recordOpenAiUsage(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Tokens d'entrée servis par le cache de prompt (Cowork #54). */
  cachedTokens?: number;
  operation: string;
  prospectId?: string | null;
}): Promise<void> {
  const { cost, tokens } = openAiCost(
    params.model,
    params.promptTokens,
    params.completionTokens,
    params.cachedTokens ?? 0,
  );
  await insert({
    service: "openai",
    operation: params.operation,
    units: tokens,
    unitCost: tokens > 0 ? cost / tokens : 0,
    cost,
    prospectId: params.prospectId,
  });
}

/** Un appel facture a l'unite : Pappers (credit), Linkup / Hunter (recherche). */
export async function recordUnitUsage(params: {
  service: Exclude<ApiService, "openai">;
  operation: string;
  units?: number;
  prospectId?: string | null;
  /**
   * Prix unitaire en euros, quand l'operation n'est pas au tarif standard du
   * service — une lecture de page Linkup ne coute pas le prix d'une recherche.
   */
  unitCost?: number;
}): Promise<void> {
  const units = params.units ?? 1;
  const unitCost = params.unitCost ?? serviceUnit(params.service).unitCost;
  await insert({
    service: params.service,
    operation: params.operation,
    units,
    unitCost,
    cost: Number((units * unitCost).toFixed(6)),
    prospectId: params.prospectId,
  });
}

/** Fournisseurs gratuits journalisés (table `free_api_calls`, sans coût). */
export type FreeService = "inpi";

/**
 * Un appel à une API GRATUITE (INPI…) : compté pour le graphe « Consommation »
 * du Cockpit, jamais facturé. Même règle que le reste : un échec d'écriture est
 * avalé, la fonctionnalité mesurée ne casse jamais.
 */
export async function recordFreeCall(params: { service: FreeService; operation: string; units?: number }): Promise<void> {
  const scriptUserId = process.env.ORION_SCRIPT_USER_ID;
  try {
    const supabase = (scriptUserId ? createAdminClient() : createClient()) as unknown as {
      from: (table: string) => { insert: (row: Record<string, unknown>) => Promise<unknown> };
    };
    await supabase.from("free_api_calls").insert({
      service: params.service,
      operation: params.operation,
      units: params.units ?? 1,
      ...(scriptUserId ? { user_id: scriptUserId } : {}),
    });
  } catch {
    // Hors contexte de requête ou base indisponible : on ne compte pas, on ne casse rien.
  }
}
