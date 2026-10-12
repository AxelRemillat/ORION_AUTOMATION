import type { Db } from "@/lib/trash/scope";

/**
 * Écriture du « lu / non lu » d'un mail reçu. Rien d'autre ne bouge : ni
 * `handled` (qui pilote la file d'« Aujourd'hui » et les relances), ni le
 * statut de la fiche, ni la moindre ligne supprimée.
 */

export type ReadResult = { ok: true; read: boolean } | { ok: false; error: string };

export async function setInboundRead(
  db: Db,
  input: { userId: string; inboundId: string; read: boolean; now?: Date },
): Promise<ReadResult> {
  const { data, error } = await db
    .from("inbound_messages")
    .update({ read_at: input.read ? (input.now ?? new Date()).toISOString() : null })
    .eq("id", input.inboundId)
    .eq("user_id", input.userId)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  // Aucune ligne : mail inconnu, d'un autre compte, ou à la corbeille.
  if (!(data as { id: string }[] | null)?.length) return { ok: false, error: "Mail introuvable ou à la corbeille." };
  return { ok: true, read: input.read };
}
