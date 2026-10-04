import { recordProspectEvent } from "@/lib/history/record";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ProspectStatus } from "@/types";

/** Statuts qui sortent un prospect du cycle de relance. */
export const CLOSES_REMINDERS: ReadonlySet<ProspectStatus> = new Set(["gagne", "perdu", "en_discussion"]);

export type WriteStatusResult = { ok: true } | { ok: false; error: string; notFound?: boolean };

/**
 * Écrit le statut d'un prospect et solde ses relances s'il sort du cycle.
 * Partagé par l'action serveur (fiche) et la route API (Kanban) : une seule
 * règle métier, deux façons de rafraîchir l'écran.
 */
export async function writeProspectStatus(
  supabase: SupabaseClient<Database>,
  prospectId: string,
  status: ProspectStatus,
): Promise<WriteStatusResult> {
  // Statut d'avant : l'historique de la fiche raconte « de → vers ».
  const { data: before } = await supabase.from("prospects").select("status").eq("id", prospectId).maybeSingle();
  const { data, error } = await supabase
    .from("prospects")
    .update({ status })
    .eq("id", prospectId)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  // RLS ou corbeille : aucune ligne touchée, l'écran ne doit pas croire le contraire.
  if (!data?.length) return { ok: false, error: "Prospect introuvable ou dans la corbeille.", notFound: true };
  const from = (before as { status?: string } | null)?.status ?? null;
  if (from !== status) await recordProspectEvent(supabase, { prospectId, kind: "status", data: { from, to: status } });

  // Le statut est écrit : un échec ici ne doit pas faire annuler le déplacement
  // à l'écran (comportement historique : les relances restent ouvertes).
  if (CLOSES_REMINDERS.has(status)) {
    await supabase
      .from("reminders")
      .update({ done: true })
      .eq("prospect_id", prospectId)
      .eq("done", false);
  }
  return { ok: true };
}
