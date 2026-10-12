import type { Db } from "@/lib/trash/scope";
import { utcToParis } from "@/lib/outbox/paris-time";
import { isSegmentKey, type SegmentKey } from "./index";
import { readAllResult } from "@/lib/supabase/read-all";

/**
 * Envois du JOUR pour un segment, en heure de Paris.
 *
 * Deux requêtes plutôt qu'une jointure : les messages envoyés d'abord, puis les
 * fiches correspondantes. C'est volontaire — la jointure imbriquée fait
 * retomber le client Supabase typé sur `never`, et deux lectures indexées
 * coûtent moins qu'un cast qui masquerait une erreur de schéma.
 *
 * Appelé seulement quand la fiche concernée porte un segment : une PME
 * ordinaire ne déclenche aucune requête supplémentaire.
 */
export async function sentTodayForSegment(
  db: Db,
  userId: string,
  segment: SegmentKey,
  now = new Date(),
): Promise<number> {
  const today = utcToParis(now).date;

  // Toutes les pages (Cowork #24) : au-delà de 1 000 envois, le quota du segment était sous-compté.
  const { data: messages } = await readAllResult(() => db.from("messages").select("prospect_id, sent_at").eq("user_id", userId).eq("status", "sent").not("sent_at", "is", null).order("id"));

  const rows = (messages ?? []) as { prospect_id: string | null; sent_at: string | null }[];
  const ids = [
    ...new Set(
      rows
        .filter((row) => row.sent_at && utcToParis(new Date(row.sent_at)).date === today)
        .map((row) => row.prospect_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  if (!ids.length) return 0;

  const { data: prospects } = await db
    .from("prospects")
    .select("id, key_figures")
    .in("id", ids);

  return ((prospects ?? []) as { key_figures: { segment?: unknown } | null }[]).filter((row) => {
    const value = row.key_figures?.segment;
    return isSegmentKey(value) && value === segment;
  }).length;
}
