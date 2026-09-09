import type { Deal, Prospect } from "@/types";

/**
 * VALEUR ESTIMÉE — DONNÉE D'EXEMPLE.
 *
 * Le schéma ne stocke un montant que sur `deals` (donc seulement une fois
 * l'affaire signée). Tant qu'aucune colonne « valeur estimée » n'existe côté
 * Supabase, on affiche une fourchette indicative calculée depuis la taille de
 * l'entreprise. Elle est TOUJOURS rendue avec la mention « exemple » et n'entre
 * jamais dans les totaux présentés comme réels.
 */

export interface EstimatedValue {
  amount: number;
  /** `reel` = montant d'un deal enregistré ; `exemple` = fourchette indicative. */
  source: "reel" | "exemple";
  /** Phrase courte expliquant d'où vient le chiffre. */
  basis: string;
}

/** Paliers indicatifs d'une mission « mise en prod IA », par taille d'entreprise. */
const BANDS: { max: number; amount: number; label: string }[] = [
  { max: 9, amount: 3_500, label: "TPE (< 10 salariés)" },
  { max: 49, amount: 8_000, label: "PME (10–49)" },
  { max: 249, amount: 18_000, label: "ETI (50–249)" },
  { max: Number.POSITIVE_INFINITY, amount: 35_000, label: "Grand compte (250+)" },
];

/** Effectif connu, depuis les chiffres clés ou la tranche INSEE textuelle. */
function headcountOf(prospect: Prospect): number | null {
  const raw = prospect.key_figures?.headcount;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;

  // `size_range` ressemble à "10 à 19 salariés" : on prend la borne basse.
  const match = prospect.size_range?.match(/\d+/);
  return match ? Number(match[0]) : null;
}

/**
 * Valeur à afficher pour un prospect : le montant réel du deal s'il existe,
 * sinon une fourchette d'exemple.
 */
export function estimateValue(prospect: Prospect, deals: Deal[]): EstimatedValue {
  const withAmount = deals.find((deal) => deal.amount_eur != null);
  if (withAmount) {
    return {
      amount: Number(withAmount.amount_eur),
      source: "reel",
      basis: "Montant du contrat enregistré",
    };
  }

  const headcount = headcountOf(prospect);
  const band = BANDS.find((item) => (headcount ?? 20) <= item.max) ?? BANDS[1];
  return {
    amount: band.amount,
    source: "exemple",
    basis:
      headcount === null
        ? "Fourchette par défaut (effectif inconnu) — donnée d'exemple"
        : `Fourchette ${band.label} — donnée d'exemple`,
  };
}

/** Somme des valeurs réelles et des valeurs d'exemple, séparées. */
export function splitPipelineValue(
  entries: EstimatedValue[],
): { real: number; example: number } {
  return entries.reduce(
    (totals, entry) => ({
      real: totals.real + (entry.source === "reel" ? entry.amount : 0),
      example: totals.example + (entry.source === "exemple" ? entry.amount : 0),
    }),
    { real: 0, example: 0 },
  );
}
