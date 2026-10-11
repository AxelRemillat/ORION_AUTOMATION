import type { Opportunity } from "./types";

/**
 * ÉTAT DU BOUTON DE PROPOSITION (Cowork #21) — code pur, importable côté client.
 *
 * Bug du 11/10 : toute fiche sans proposition affichait « Proposition en cours… », grisé,
 * pour toujours. Or les alertes « Lancement » venues du rattrapage ou d'une alerte e-mail à
 * titre seul n'avaient JAMAIS lancé de rédaction (aucun appel au modèle, par conception) :
 * rien n'était « en cours ». Désormais : « en cours » seulement si une rédaction tourne
 * vraiment (clic en cours, ou analyse « pending » de moins de 10 minutes) ; « Échec —
 * réessayer » si elle a échoué ou si l'analyse est restée bloquée ; sinon « Rédiger ».
 */
export type ProposalButtonState = "copier" | "en_cours" | "echec" | "rediger";

/** Préfixe du motif d'une rédaction ratée, écrit par lib/opportunities/run.ts. */
export const PROPOSAL_FAILED = "Échec de la rédaction";

/** Une analyse « pending » plus vieille que ça ne finira plus (arrière-plan interrompu). */
export const PENDING_STALE_MINUTES = 10;

export const PROPOSAL_BUTTON_LABELS: Record<ProposalButtonState, string> = {
  copier: "Copier la proposition",
  en_cours: "Proposition en cours…",
  echec: "Échec — réessayer",
  rediger: "Rédiger la proposition",
};

type Row = Pick<Opportunity, "proposal"> & Partial<Pick<Opportunity, "proposal_reason" | "analysis_state" | "updated_at" | "created_at">>;

export function proposalButtonState(row: Row, busy = false, now = new Date()): ProposalButtonState {
  if (row.proposal) return "copier";
  if (busy) return "en_cours";
  if (row.proposal_reason?.startsWith(PROPOSAL_FAILED) || row.analysis_state === "non_analysee") return "echec";
  if (row.analysis_state === "pending") {
    const at = Date.parse(row.updated_at ?? row.created_at ?? "");
    return Number.isNaN(at) || now.getTime() - at < PENDING_STALE_MINUTES * 60_000 ? "en_cours" : "echec";
  }
  return "rediger";
}
