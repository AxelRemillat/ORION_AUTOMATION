import type { SupabaseClient } from "@supabase/supabase-js";
import { flatten } from "@/lib/today/group";
import { readAll } from "@/lib/supabase/read-all";
import { loadToday } from "@/lib/today/load";
import { buildVolumes, type Volumes } from "./volumes";

type Loose = SupabaseClient<any, "public", any>;

/** Volumes de Réglages › Données (session de l'utilisateur, RLS). */
export async function loadVolumes(db: unknown, userId: string): Promise<Volumes> {
  const loose = db as Loose;
  // Lectures complètes (pages de 1 000) : un volume ne doit jamais plafonner à 1 000.
  const all = (table: string, columns: string) =>
    readAll<Record<string, unknown>>(() => loose.from(table).select(columns).is("deleted_at", null).order("id"));
  const [prospects, messages, inbound, today] = await Promise.all([
    all("prospects", "id, status, do_not_contact"),
    all("messages", "id, status, type, gmail_message_id, send_status"),
    all("inbound_messages", "id, from_email, subject, body"),
    loadToday(db as never, userId).catch(() => null),
  ]);
  const tags = today ? flatten(today.groups).flatMap((item) => item.tags) : [];
  return buildVolumes({
    prospects: prospects as never,
    messages: messages as never,
    inbound: inbound as never,
    tags,
  });
}
