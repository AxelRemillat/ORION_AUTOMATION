import type { Deal } from "@/types";

/**
 * VALEUR D'UN PROSPECT — montants réels uniquement.
 *
 * Ce module produisait auparavant une « fourchette indicative » déduite de
 * l'effectif (3 500 € pour une TPE, 8 000 € pour une PME…). Ces montants
 * n'avaient aucun fondement et se retrouvaient additionnés dans la valeur du
 * pipeline. Ils sont supprimés : la seule valeur affichée est celle que
 * l'utilisateur a saisie sur un deal. Rien de saisi, rien d'affiché.
 */

export interface DealValue {
  /** Montant saisi par l'utilisateur, ou `null` si aucun. */
  amount: number | null;
  /** `reel` = montant saisi ; `absent` = aucune estimation renseignée. */
  source: "reel" | "absent";
  /** Phrase courte expliquant d'où vient le chiffre (ou son absence). */
  basis: string;
  /** Deal ouvert portant le montant, cible de l'édition en ligne. */
  openDealId: string | null;
}

const NO_VALUE: DealValue = {
  amount: null,
  source: "absent",
  basis: "Aucun montant estimé saisi",
  openDealId: null,
};

/**
 * Valeur à afficher pour un prospect.
 * Un deal gagné fait foi ; sinon on prend le deal ouvert et son estimation.
 */
export function dealValue(deals: Deal[]): DealValue {
  const won = deals.find((deal) => deal.status === "gagne" && deal.amount_eur != null);
  if (won) {
    return {
      amount: Number(won.amount_eur),
      source: "reel",
      basis: "Montant du contrat signé",
      openDealId: null,
    };
  }

  const open = deals.find((deal) => deal.status === "ouvert");
  if (!open) return NO_VALUE;

  if (open.amount_eur == null) {
    return { ...NO_VALUE, openDealId: open.id };
  }

  return {
    amount: Number(open.amount_eur),
    source: "reel",
    basis: "Montant estimé, saisi à la main",
    openDealId: open.id,
  };
}

/**
 * Somme des montants réellement saisis.
 * Aucun montant renseigné ⇒ 0, jamais une valeur reconstituée.
 */
export function sumPipeline(values: DealValue[]): number {
  return values.reduce((total, entry) => total + (entry.amount ?? 0), 0);
}

/** Nombre d'entrées effectivement chiffrées, pour nuancer un total. */
export function countValued(values: DealValue[]): number {
  return values.filter((entry) => entry.amount != null).length;
}
