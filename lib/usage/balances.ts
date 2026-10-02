import { fetchJson } from "@/lib/enrichment/http";
import type { ApiService } from "@/types";
import { openAiMonthlyBudget, serviceUnit, USD_EUR_RATE } from "./pricing";

/**
 * Ce qu'il reste chez chaque fournisseur.
 *
 * Deux qualites de reponse, jamais melangees :
 *   - `exact`  : la valeur vient de l'API du fournisseur. C'est sa comptabilite.
 *   - `estime` : la valeur est reconstituee par l'app (forfait connu moins la
 *                consommation enregistree). Elle ignore tout appel passe hors
 *                de l'app, et vaut donc borne superieure, pas verite.
 *
 * Etat des endpoints au 20 septembre 2026 :
 *   - Hunter  : GET /v2/account — documente, renvoie les recherches restantes.
 *   - Linkup  : GET /v1/credits/balance — documente, renvoie un solde en $.
 *   - Pappers : GET /v2/suivi-jetons — documente, renvoie les jetons restants.
 *               Les noms de champs varient selon les versions : on tente
 *               plusieurs cles et on bascule en estimation si aucune ne sort.
 *   - OpenAI  : aucun endpoint de solde fiable. Seul le cout consomme est sur ;
 *               le restant n'existe que si un budget mensuel est configure.
 *
 * Les cles ne quittent jamais le serveur : ce module n'est appele que depuis
 * des Server Components et des Route Handlers.
 */

export type BalanceQuality = "exact" | "estime";

export interface ServiceBalance {
  service: ApiService;
  /** Quantite restante dans l'unite du fournisseur, ou `null` si inconnue. */
  remaining: number | null;
  /** Unite de `remaining` : "recherche", "crédit", "€"... */
  unit: string;
  quality: BalanceQuality;
  /** Phrase expliquant d'ou vient le chiffre — affichee telle quelle. */
  basis: string;
  /** Renseigne quand la valeur n'a pas pu etre obtenue. */
  error?: string;
}

const UNKNOWN = (service: ApiService, unit: string, basis: string): ServiceBalance => ({
  service,
  remaining: null,
  unit,
  quality: "estime",
  basis,
});

// ---------------------------------------------------------------------------
// Hunter — endpoint officiel, valeur exacte
// ---------------------------------------------------------------------------

interface HunterAccount {
  data?: { requests?: { searches?: { used?: number; available?: number } } };
}

async function hunterBalance(): Promise<ServiceBalance> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return UNKNOWN("hunter", "recherche", "Clé absente : solde indisponible.");

  const response = await fetchJson<HunterAccount>(
    `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`,
    {},
    10_000,
  );
  if (!response.ok) {
    return { ...UNKNOWN("hunter", "recherche", "Solde non récupéré."), error: response.error };
  }

  const searches = response.data.data?.requests?.searches;
  if (typeof searches?.available !== "number") {
    return UNKNOWN("hunter", "recherche", "Réponse Hunter sans compteur de recherches.");
  }
  const used = typeof searches.used === "number" ? searches.used : 0;
  return {
    service: "hunter",
    remaining: Math.max(0, searches.available - used),
    unit: "recherche",
    quality: "exact",
    basis: `Compte Hunter : ${used} / ${searches.available} recherches utilisées.`,
  };
}

// ---------------------------------------------------------------------------
// Linkup — endpoint officiel, solde en dollars
// ---------------------------------------------------------------------------

async function linkupBalance(): Promise<ServiceBalance> {
  const key = process.env.LINKUP_API_KEY;
  if (!key) return UNKNOWN("linkup", "€", "Clé absente : solde indisponible.");

  const response = await fetchJson<{ balance?: number }>(
    "https://api.linkup.so/v1/credits/balance",
    { headers: { Authorization: `Bearer ${key}` } },
    10_000,
  );
  if (!response.ok) {
    return { ...UNKNOWN("linkup", "€", "Solde non récupéré."), error: response.error };
  }
  if (typeof response.data.balance !== "number") {
    return UNKNOWN("linkup", "€", "Réponse Linkup sans champ `balance`.");
  }

  return {
    service: "linkup",
    remaining: Number((response.data.balance * USD_EUR_RATE).toFixed(2)),
    unit: "€",
    quality: "exact",
    basis: `Solde Linkup : ${response.data.balance.toFixed(2)} $ (converti au taux ${USD_EUR_RATE}).`,
  };
}

// ---------------------------------------------------------------------------
// Pappers — endpoint documente, schema de reponse a confirmer
// ---------------------------------------------------------------------------

/**
 * Jetons restants d'une réponse `/v2/suivi-jetons`. Format constaté le
 * 02/10/2026 : `{ jetons_abonnement, jetons_abonnement_utilises,
 * jetons_pay_as_you_go_restants }` — le restant est le forfait du mois moins
 * l'utilisé, plus le pay-as-you-go. Les anciens noms restent lus en repli.
 */
export function pappersRemaining(data: Record<string, unknown>): number | null {
  const num = (key: string) => (typeof data[key] === "number" && Number.isFinite(data[key]) ? (data[key] as number) : null);
  const plan = num("jetons_abonnement");
  if (plan !== null) {
    const used = num("jetons_abonnement_utilises") ?? 0;
    return Math.max(0, plan - used) + Math.max(0, num("jetons_pay_as_you_go_restants") ?? 0);
  }
  const legacy = PAPPERS_KEYS.map(num).find((value): value is number => value !== null);
  return legacy === undefined ? null : Math.max(0, legacy);
}

/** Crédits Pappers restants (exact), `null` si inconnus. Gratuit, mis en cache 5 min. */
let creditsCache: { at: number; value: number | null } | null = null;
export async function pappersCredits(now = Date.now()): Promise<number | null> {
  if (creditsCache && now - creditsCache.at < 5 * 60_000) return creditsCache.value;
  const key = process.env.PAPPERS_API_KEY;
  if (!key) return null;
  const response = await fetchJson<Record<string, unknown>>(
    `https://api.pappers.fr/v2/suivi-jetons?api_token=${encodeURIComponent(key)}`,
    {},
    10_000,
  );
  const value = response.ok ? pappersRemaining(response.data) : null;
  creditsCache = { at: now, value };
  return value;
}

/** Cles rencontrees selon les versions de l'API ; la premiere trouvee gagne. */
const PAPPERS_KEYS = [
  "jetons_restants",
  "jetons_restants_pay_as_you_go",
  "credits_restants",
  "solde",
];

async function pappersBalance(consumed: number): Promise<ServiceBalance> {
  const key = process.env.PAPPERS_API_KEY;
  if (!key) return UNKNOWN("pappers", "crédit", "Clé absente : solde indisponible.");

  const response = await fetchJson<Record<string, unknown>>(
    `https://api.pappers.fr/v2/suivi-jetons?api_token=${encodeURIComponent(key)}`,
    {},
    10_000,
  );

  if (response.ok) {
    const found = pappersRemaining(response.data);
    if (found !== null) {
      return {
        service: "pappers",
        remaining: found,
        unit: "crédit",
        quality: "exact",
        basis: "Compte Pappers (/suivi-jetons).",
      };
    }
  }

  // Repli assume : forfait par defaut moins ce que l'app a consomme.
  const plan = Number(process.env.PAPPERS_PLAN_CREDITS ?? "500");
  return {
    service: "pappers",
    remaining: Math.max(0, plan - consumed),
    unit: "crédit",
    quality: "estime",
    basis: `Estimation : forfait de ${plan} crédits moins ${consumed} consommés par l'app.`,
    error: response.ok ? "Réponse Pappers sans compteur reconnu." : response.error,
  };
}

// ---------------------------------------------------------------------------
// OpenAI — pas de solde, seulement un budget que l'utilisateur fixe
// ---------------------------------------------------------------------------

function openAiBalance(consumedEur: number): ServiceBalance {
  const budget = openAiMonthlyBudget();
  if (budget === null) {
    return UNKNOWN(
      "openai",
      "€",
      "OpenAI n'expose pas de solde. Définissez OPENAI_MONTHLY_BUDGET_EUR pour estimer le restant.",
    );
  }
  return {
    service: "openai",
    remaining: Math.max(0, Number((budget - consumedEur).toFixed(2))),
    unit: "€",
    quality: "estime",
    basis: `Estimation : budget de ${budget} € moins ${consumedEur.toFixed(2)} € consommés par l'app.`,
  };
}

/**
 * Soldes des quatre services. Les appels partent en parallele et aucun ne peut
 * faire echouer la page : un fournisseur muet devient une ligne « inconnu ».
 */
export async function fetchBalances(consumed: {
  openaiEur: number;
  pappersCredits: number;
}): Promise<ServiceBalance[]> {
  const [hunter, linkup, pappers] = await Promise.all([
    hunterBalance().catch(() => UNKNOWN("hunter", "recherche", "Appel impossible.")),
    linkupBalance().catch(() => UNKNOWN("linkup", "€", "Appel impossible.")),
    pappersBalance(consumed.pappersCredits).catch(() =>
      UNKNOWN("pappers", "crédit", "Appel impossible."),
    ),
  ]);
  return [openAiBalance(consumed.openaiEur), pappers, linkup, hunter];
}

/** Prix unitaire affichable pour les services factures a l'unite. */
export { serviceUnit };
