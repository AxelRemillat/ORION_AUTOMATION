import type { ApiService, ApiUsage } from "@/types";
import type { ServiceBalance } from "@/lib/usage/balances";

/**
 * Agregation de la consommation, en fonctions pures.
 *
 * Tout ce qui est calcule ici vient de `api_usage`, c'est-a-dire de ce que
 * L'APP a consomme. Un appel passe depuis un autre outil avec la meme cle
 * n'y figure pas : l'ecran le dit, et les soldes fournisseurs servent de
 * reference quand ils existent.
 */

export interface ServiceUsage {
  service: ApiService;
  /** Nombre d'appels factures. */
  calls: number;
  /** Quantite consommee dans l'unite du fournisseur (tokens, crédits...). */
  units: number;
  /** Cout en euros, 0 quand aucun prix n'est configure pour ce service. */
  cost: number;
}

export interface UsageTotals {
  byService: ServiceUsage[];
  totalCost: number;
  totalCalls: number;
}

const SERVICES: ApiService[] = ["openai", "pappers", "linkup", "hunter"];

/** Consommation cumulee par service, dans l'ordre d'affichage. */
export function aggregate(rows: ApiUsage[]): UsageTotals {
  const byService = SERVICES.map((service) => {
    const own = rows.filter((row) => row.service === service);
    return {
      service,
      calls: own.length,
      units: own.reduce((total, row) => total + Number(row.units ?? 0), 0),
      cost: own.reduce((total, row) => total + Number(row.cost ?? 0), 0),
    };
  });

  return {
    byService,
    totalCost: byService.reduce((total, entry) => total + entry.cost, 0),
    totalCalls: byService.reduce((total, entry) => total + entry.calls, 0),
  };
}

export interface PerProspect {
  /** Cout moyen en euros pour un prospect enregistre. */
  cost: number;
  /** Consommation moyenne par prospect, par service, en unites natives. */
  units: Record<ApiService, number>;
  /** Cout moyen en euros par prospect, service par service. */
  costByService: Record<ApiService, number>;
  /** Base du calcul : nombre de prospects en base. */
  prospects: number;
}

/**
 * Cout moyen d'un prospect ENREGISTRE.
 *
 * On divise par le nombre de prospects en base, pas par le nombre
 * d'entreprises enrichies : une recherche enrichit des entreprises qu'on
 * n'ajoute pas, et leur cout fait bien partie du prix d'acquisition d'un
 * prospect. Le chiffre est donc « ce que me coute un prospect dans ma base ».
 */
export function perProspect(totals: UsageTotals, prospects: number): PerProspect | null {
  if (prospects <= 0) return null;

  const units = Object.fromEntries(
    totals.byService.map((entry) => [entry.service, entry.units / prospects]),
  ) as Record<ApiService, number>;
  const costByService = Object.fromEntries(
    totals.byService.map((entry) => [entry.service, entry.cost / prospects]),
  ) as Record<ApiService, number>;

  return { cost: totals.totalCost / prospects, units, costByService, prospects };
}

export interface RemainingEstimate {
  /** Nombre de prospects encore traitables, au plus juste. */
  prospects: number;
  /** Service qui limite le plus. */
  limiting: ApiService;
  /** `true` si le solde du service limitant vient de son API. */
  exact: boolean;
  basis: string;
}

/**
 * Combien de prospects il reste, dicte par la ressource la plus limitante.
 *
 * Pour chaque service on divise ce qu'il reste par ce qu'un prospect consomme,
 * chacun dans sa propre unite — des euros pour OpenAI et Linkup, des credits
 * ou des recherches pour Pappers et Hunter. Le minimum l'emporte.
 * Un service sans solde connu, ou jamais utilise, ne peut pas limiter :
 * on ne l'inclut pas plutot que de supposer.
 */
export function remainingProspects(
  balances: ServiceBalance[],
  usage: PerProspect,
  labels: Record<ApiService, string>,
): RemainingEstimate | null {
  const candidates = balances.flatMap((balance) => {
    if (balance.remaining === null) return [];

    // Un solde en euros se compare a un cout en euros ; un solde en unites
    // natives se compare a une consommation en unites natives.
    const perUnit =
      balance.unit === "€"
        ? usage.costByService[balance.service]
        : usage.units[balance.service];

    if (!Number.isFinite(perUnit) || perUnit <= 0) return [];
    return [
      {
        service: balance.service,
        prospects: Math.floor(balance.remaining / perUnit),
        exact: balance.quality === "exact",
        detail: `${formatNumber(balance.remaining)} ${balance.unit} restants ÷ ${formatNumber(
          perUnit,
        )} ${balance.unit} par prospect`,
      },
    ];
  });

  if (!candidates.length) return null;

  const worst = candidates.reduce((min, item) => (item.prospects < min.prospects ? item : min));
  return {
    prospects: worst.prospects,
    limiting: worst.service,
    exact: worst.exact,
    basis: `${labels[worst.service]} : ${worst.detail}.`,
  };
}

function formatNumber(value: number): string {
  if (value >= 100) return String(Math.round(value));
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}
