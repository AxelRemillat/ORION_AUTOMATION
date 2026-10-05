import { readAll } from "@/lib/supabase/read-all";
import { variantStats, type InboundLite, type SentVariant, type ValueStats, type VariantAttribute } from "./stats";

/**
 * Lecture des variantes ENVOYÉES et des réponses reçues, page par page.
 * Table absente (avant migration) : aucune donnée, rien ne casse.
 */
type Reader = { from: (table: string) => any };

export async function loadVariantStats(db: unknown): Promise<{ sends: number; stats: Record<VariantAttribute, ValueStats[]> }> {
  const reader = db as Reader;
  const rows = await readAll<Record<string, any>>(() =>
    reader
      .from("message_variants")
      .select("message_id, hook_type, pain, demo, cta, subject_style, opening_word, length, family, messages(prospect_id, sent_at, status, deleted_at)")
      .order("message_id"),
  ).catch(() => []);
  const sent: SentVariant[] = rows
    .filter((row) => row.messages?.status === "sent" && row.messages.sent_at && !row.messages.deleted_at)
    .map((row) => ({ ...row, prospect_id: row.messages.prospect_id, sent_at: row.messages.sent_at }));
  const inbound = sent.length
    ? await readAll<InboundLite & { id: string }>(() =>
        reader.from("inbound_messages").select("id, prospect_id, received_at, from_email, subject, body, category").is("deleted_at", null).order("id"),
      ).catch(() => [])
    : [];
  return { sends: sent.length, stats: variantStats(sent, inbound) };
}
