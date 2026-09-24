import { createClient } from "@/lib/supabase/server";
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
 */

interface UsageEntry {
  service: ApiService;
  operation: string;
  units: number;
  unitCost: number;
  cost: number;
  prospectId?: string | null;
}

async function insert(entry: UsageEntry): Promise<void> {
  try {
    const supabase = createClient();
    await supabase.from("api_usage").insert({
      service: entry.service,
      operation: entry.operation,
      units: Number(entry.units.toFixed(4)),
      unit_cost: Number(entry.unitCost.toFixed(6)),
      cost: Number(entry.cost.toFixed(6)),
      prospect_id: entry.prospectId ?? null,
    });
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
  operation: string;
  prospectId?: string | null;
}): Promise<void> {
  const { cost, tokens } = openAiCost(
    params.model,
    params.promptTokens,
    params.completionTokens,
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
