import type { SupabaseClient } from "@supabase/supabase-js";
import { flatten } from "@/lib/today/group";
import { loadToday } from "@/lib/today/load";
import { buildVolumes, type Volumes } from "./volumes";

type Loose = SupabaseClient<any, "public", any>;

/** Volumes de Réglages › Données (session de l'utilisateur, RLS). */
export async function loadVolumes(db: unknown, userId: string): Promise<Volumes> {
  const loose = db as Loose;
  const [prospects, messages, inbound, today] = await Promise.all([
    loose.from("prospects").select("status, do_not_contact").is("deleted_at", null).limit(10_000),
    loose.from("messages").select("status, type, gmail_message_id, send_status").is("deleted_at", null).limit(20_000),
    loose.from("inbound_messages").select("from_email, subject").is("deleted_at", null).limit(20_000),
    loadToday(db as never, userId).catch(() => null),
  ]);
  const tags = today ? flatten(today.groups).flatMap((item) => item.tags) : [];
  return buildVolumes({
    prospects: (prospects.data ?? []) as never,
    messages: (messages.data ?? []) as never,
    inbound: (inbound.data ?? []) as never,
    tags,
  });
}
