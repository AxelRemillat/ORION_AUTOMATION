import { readAll } from "@/lib/supabase/read-all";
import { variantStats, type InboundLite, type SentVariant, type ValueStats, type VariantAttribute } from "./stats";

/**
 * Lecture des variantes ENVOYÉES et des réponses reçues, page par page.
 * Table absente (avant migration) : aucune donnée, rien ne casse.
 */
type Reader = { from: (table: string) => any };

export async function loadVariantStats(db: unknown): Promise<{ sends: number; stats: Record<VariantAttribute, ValueStats[]>; families: Map<string, string> }> {
  const reader = db as Reader;
  // Les deux lectures EN PARALLÈLE (Cowork #23) : elles étaient l'une après l'autre (≈ 4 à 8 s sur /suivi).
  const [rows, inbound] = await Promise.all([
    readAll<Record<string, any>>(() =>
      reader
        .from("message_variants")
        .select("message_id, hook_type, pain, demo, cta, subject_style, opening_word, length, family, messages(prospect_id, sent_at, status, deleted_at)")
        .order("message_id"),
    ).catch(() => []),
    readAll<InboundLite & { id: string }>(() =>
      reader.from("inbound_messages").select("id, prospect_id, received_at, from_email, subject, body, category").is("deleted_at", null).order("id"),
    ).catch(() => []),
  ]);
  const sent: SentVariant[] = rows
    .filter((row) => row.messages?.status === "sent" && row.messages.sent_at && !row.messages.deleted_at)
    .map((row) => ({ ...row, prospect_id: row.messages.prospect_id, sent_at: row.messages.sent_at }));
  // Famille de chaque message (badge du pipeline) : déjà lue ici, plus besoin d'une seconde lecture.
  const families = new Map<string, string>();
  for (const row of rows) if (row.family) families.set(String(row.message_id), String(row.family));
  return { sends: sent.length, stats: variantStats(sent, sent.length ? inbound : []), families };
}
