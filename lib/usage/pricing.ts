import type { ApiService } from "@/types";

/**
 * Tarifs des APIs tierces.
 *
 * Deux natures de prix, a ne pas confondre a l'affichage :
 *   - OpenAI et Linkup sont factures en DOLLARS, a l'usage. Le cout est donc
 *     calculable exactement, a la conversion pres.
 *   - Pappers et Hunter sont factures en CREDITS / recherches inclus dans un
 *     abonnement. On compte exactement la consommation, mais leur valeur en
 *     euros depend du plan souscrit : elle n'est connue que si l'utilisateur
 *     la renseigne. Sans prix configure, le cout vaut 0 et l'ecran affiche la
 *     consommation brute plutot qu'un montant invente.
 *
 * Tous les prix sont surchargeables par variable d'environnement : une grille
 * tarifaire bouge, et on ne veut pas redeployer pour ca.
 */

/** Taux de conversion USD -> EUR. Approximation assumee, signalee dans l'UI. */
export const USD_EUR_RATE = Number(process.env.USD_EUR_RATE ?? "0.92");

const envNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

// ---------------------------------------------------------------------------
// OpenAI — prix au million de tokens, en dollars
// ---------------------------------------------------------------------------

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Grille publique constatee en septembre 2026. Un modele absent retombe sur
 * `DEFAULT_MODEL_PRICE` et le cout est alors marque comme approximatif.
 */
const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8 },
  "gpt-4.1-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
};

// TODO(tarifs) : ajouter ici les modeles retenus pour le stratege, le
// redacteur, l'extraction et le juge (lib/ai/models.ts, PROPOSED_MODELS), avec
// les prix relus sur developers.openai.com/api/docs/pricing. La page n'etait
// pas accessible lors de l'ecriture : aucun prix n'a ete devine. En attendant,
// OPENAI_PRICES_JSON permet de les renseigner sans redeployer le code.

const DEFAULT_MODEL_PRICE: ModelPrice = { inputPerMillion: 0.15, outputPerMillion: 0.6 };

/**
 * Prix fournis par l'environnement, prioritaires sur la grille :
 *   OPENAI_PRICES_JSON='{"mon-modele":{"input":1.25,"output":10}}'
 * En dollars par million de tokens. Une entree mal formee est ignoree.
 */
export function envModelPrices(raw = process.env.OPENAI_PRICES_JSON): Record<string, ModelPrice> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, { input?: unknown; output?: unknown }>;
    const prices: Record<string, ModelPrice> = {};
    for (const [model, value] of Object.entries(parsed ?? {})) {
      const input = Number(value?.input);
      const output = Number(value?.output);
      if (Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
        prices[model] = { inputPerMillion: input, outputPerMillion: output };
      }
    }
    return prices;
  } catch {
    return {};
  }
}

/** Prix d'un modele : environnement, puis grille, sinon `null` (inconnu). */
export function modelPrice(model: string): ModelPrice | null {
  return envModelPrices()[model] ?? MODEL_PRICES[model] ?? null;
}

export interface OpenAiCost {
  /** Cout en euros de l'appel. */
  cost: number;
  /** Total des tokens, entree + sortie. */
  tokens: number;
  /** `false` quand le modele n'est pas dans la grille : prix par defaut applique. */
  priceKnown: boolean;
}

/** Cout exact d'un appel OpenAI, a partir du bloc `usage` de la reponse. */
export function openAiCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): OpenAiCost {
  const known = modelPrice(model);
  const price = known ?? DEFAULT_MODEL_PRICE;
  const usd =
    (promptTokens / 1_000_000) * price.inputPerMillion +
    (completionTokens / 1_000_000) * price.outputPerMillion;

  return {
    cost: Number((usd * USD_EUR_RATE).toFixed(6)),
    tokens: promptTokens + completionTokens,
    priceKnown: Boolean(known),
  };
}

// ---------------------------------------------------------------------------
// Services a l'unite
// ---------------------------------------------------------------------------

export interface ServiceUnit {
  /** Nom de l'unite consommee, au singulier. */
  unit: string;
  /** Prix unitaire en euros. 0 = inconnu tant que l'utilisateur ne l'a pas dit. */
  unitCost: number;
  /** `true` quand le prix vient d'une grille publique, pas d'une supposition. */
  priceKnown: boolean;
  /** D'ou vient ce prix, affiche tel quel dans l'ecran Couts. */
  basis: string;
}

/** Prix unitaire par service, hors OpenAI (facture aux tokens). */
export function serviceUnit(service: Exclude<ApiService, "openai">): ServiceUnit {
  switch (service) {
    case "linkup": {
      // Tarif public : 0,005 $ la recherche en profondeur standard.
      const usd = envNumber("LINKUP_SEARCH_USD", 0.005);
      return {
        unit: "recherche",
        unitCost: Number((usd * USD_EUR_RATE).toFixed(6)),
        priceKnown: true,
        basis: `${usd} $ / recherche, converti en euros`,
      };
    }
    case "pappers": {
      // Grille Pappers : 1 credit par fiche entreprise. La valeur en euros
      // d'un credit depend du forfait : inconnue tant qu'elle n'est pas dite.
      const eur = envNumber("PAPPERS_CREDIT_EUR", 0);
      return {
        unit: "crédit",
        unitCost: eur,
        priceKnown: eur > 0,
        basis: eur > 0 ? `${eur} € / crédit (PAPPERS_CREDIT_EUR)` : "1 crédit par fiche entreprise",
      };
    }
    case "hunter": {
      const eur = envNumber("HUNTER_SEARCH_EUR", 0);
      return {
        unit: "recherche",
        unitCost: eur,
        priceKnown: eur > 0,
        basis: eur > 0 ? `${eur} € / recherche (HUNTER_SEARCH_EUR)` : "1 recherche par domaine",
      };
    }
  }
}

/**
 * Tarif d'une lecture de page via Linkup (/v1/fetch).
 * Mode standard, markdown, sans rendu JS : 0,001 $ l'appel.
 */
export function linkupFetchCost(): number {
  const usd = envNumber("LINKUP_FETCH_USD", 0.001);
  return Number((usd * USD_EUR_RATE).toFixed(6));
}

/** Budget mensuel OpenAI, optionnel, pour estimer ce qu'il reste. */
export function openAiMonthlyBudget(): number | null {
  const raw = process.env.OPENAI_MONTHLY_BUDGET_EUR;
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Libellés des services, pour l'affichage. */
export const SERVICE_LABELS: Record<ApiService, string> = {
  openai: "OpenAI",
  pappers: "Pappers",
  linkup: "Linkup",
  hunter: "Hunter",
};
