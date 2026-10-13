import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { openAiBudget } from "@/lib/usage/budgets-server";

/**
 * PLAFOND OPENAI d'« Aujourd'hui », mis en cache 5 minutes (Cowork #25).
 *
 * Il ne sert qu'à dire « Plafond OpenAI du mois atteint » sur le bouton de lancement,
 * mais sa lecture parcourt tout l'historique du mois (9 pages de 1 000 lignes, l'une
 * après l'autre) : c'était le chemin le plus long de la page (≈ 2 s). Une valeur vieille
 * de 5 minutes au plus suffit ; la préparation garde, elle, son propre contrôle en direct.
 * Client service : l'application n'a qu'un compte (comme les autres lectures de coûts).
 */
export const OPENAI_GATE_TTL_SECONDS = 300;

export const cachedOpenAiBudget = unstable_cache(
  async () => openAiBudget({ db: createAdminClient() as never }).catch(() => null),
  ["aujourdhui-openai-budget"],
  { revalidate: OPENAI_GATE_TTL_SECONDS },
);
