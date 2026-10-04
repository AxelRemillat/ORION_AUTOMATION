import type { SupabaseClient } from "@supabase/supabase-js";
import type { HistoryRow } from "./build";

/**
 * Lecture de l'historique d'une fiche en UNE requête agrégée (relations
 * embarquées PostgREST) : pas de N+1, aucun appel externe.
 */

type Loose = SupabaseClient<any, "public", any>;

const BASE =
  "id, company_name, status, do_not_contact, key_figures, signals, created_at, updated_at, " +
  "messages(id, type, status, send_status, subject, body, sent_at, scheduled_at, created_at, send_error, deleted_at, origin), " +
  "inbound_messages(id, from_email, subject, body, category, received_at, deleted_at), " +
  "reminders(id, due_at, done), " +
  "deals(id, status, amount_eur, signed_at, created_at), " +
  "signal_candidates(id, source, date_signal, facts, created_at)";
const WITH_EVENTS = `${BASE}, prospect_events(id, channel, kind, at, data)`;

export async function loadHistoryRow(db: unknown, prospectId: string): Promise<HistoryRow | null> {
  const loose = db as Loose;
  const read = (columns: string) => loose.from("prospects").select(columns).eq("id", prospectId).maybeSingle();
  let { data, error } = await read(WITH_EVENTS);
  // Table `prospect_events` pas encore migrée (entre déploiement et migration) : historique sans elle.
  if (error) ({ data, error } = await read(BASE));
  if (error || !data) return null;
  return data as unknown as HistoryRow;
}
