import { recordProspectEvent } from "@/lib/history/record";
import type { Db } from "@/lib/trash/scope";

/**
 * « Opposition non vérifiée » : aucune source (Pappers, INPI) n'a pu dire si
 * l'entreprise s'oppose à la prospection. La fiche reste visible, mais rien ne
 * se programme tant que l'opposition n'est pas vérifiée — au run suivant de
 * l'entonnoir, ou à la main (« j'ai vérifié manuellement »).
 *
 * Seul un `false` EXPLICITE bloque : les fiches antérieures au repli gratuit
 * n'ont pas le champ et ne changent pas de comportement.
 */
export function oppositionUnverified(figures: Record<string, unknown> | null | undefined): boolean {
  return (figures ?? {}).opposition_checked === false;
}

export const OPPOSITION_UNVERIFIED_ERROR =
  "Opposition à la prospection non vérifiée : vérifiez-la (annuaire-entreprises.data.gouv.fr ou INPI) avant de programmer.";

/** L'utilisateur a vérifié lui-même : la fiche redevient programmable. */
export async function confirmOppositionManually(
  db: Db,
  userId: string,
  prospectId: string,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await db
    .from("prospects")
    .select("id, key_figures")
    .eq("id", prospectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Prospect introuvable." };
  const figures = ((data as { key_figures?: Record<string, unknown> | null }).key_figures ?? {}) as Record<string, unknown>;
  const { error } = await db
    .from("prospects")
    .update({
      key_figures: { ...figures, opposition_checked: true, opposition_source: "manuel", opposition_checked_at: now.toISOString() },
    })
    .eq("id", prospectId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  await recordProspectEvent(db, { prospectId, kind: "opposition", data: { refuses: false, source: "manuel" }, at: now.toISOString() });

  // Le bandeau de l'entonnoir ne la compte plus parmi les « non vérifiées ».
  const { data: rows } = await db
    .from("signal_candidates")
    .select("id, contact")
    .eq("user_id", userId)
    .eq("prospect_id", prospectId);
  for (const row of (rows ?? []) as { id: string; contact: Record<string, unknown> | null }[]) {
    if (row.contact?.opposition_unverified !== true) continue;
    await db
      .from("signal_candidates")
      .update({ contact: { ...row.contact, opposition_unverified: false } })
      .eq("id", row.id);
  }
  return { ok: true };
}
