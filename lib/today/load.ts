import type { SupabaseClient } from "@supabase/supabase-js";
import { toCard } from "@/lib/funnel/view";
import { signatureFor } from "@/lib/offer/model";
import { loadOffer } from "@/lib/offer/read";
import { offWeekend, parisToUtc, utcToParis } from "@/lib/outbox/paris-time";
import type { Database, InboundMessage, Message, Prospect, ProspectDiscard, SignalCandidateRow } from "@/types";
import { groupToday, type RawTodayItem } from "./group";
import { prospectItem, relanceItem, replyItem } from "./items";
import type { TodayGroup } from "./types";

/**
 * Chargement de « Aujourd'hui » : la file est RECALCULÉE depuis les tables
 * existantes à chaque ouverture. Rien n'est recopié — les fiches déjà trouvées
 * par les runs précédents y figurent d'office, et rien ne peut diverger.
 */

type Db = SupabaseClient<Database>;
type Row = Message & { validated_at?: string | null };

const NEXT_RELANCE: Record<string, "relance_1" | "relance_2"> = { intro: "relance_1", relance_1: "relance_2" };
const FOLLOWS_UP = new Set(["contacte", "relance_1"]);

/** Jour Paris d'un instant ISO. */
const parisDay = (iso: string | null | undefined) => (iso ? utcToParis(new Date(iso)).date : null);

/** Un message compte dans la file du jour s'il n'est pas parti un autre jour. */
function liveToday(message: Row | null, today: string): boolean {
  if (!message) return true;
  if (message.status === "sent") return parisDay(message.sent_at) === today;
  if (message.send_status === "scheduled" || message.send_status === "sending") return parisDay(message.scheduled_at) === today;
  return true;
}

/** Un message est déjà parti vers ce prospect (intro, relance ou réponse). */
export function contactedProspect(messages: readonly Pick<Message, "prospect_id" | "status" | "sent_at">[], prospectId: string): boolean {
  return messages.some((row) => row.prospect_id === prospectId && (row.status === "sent" || Boolean(row.sent_at)));
}

export interface TodayData {
  today: string;
  groups: TodayGroup[];
}

export async function loadToday(db: Db, userId: string, now = new Date()): Promise<TodayData> {
  const today = utcToParis(now).date;
  const endOfDay = parisToUtc(today, "23:59")!;

  const [prospectsRes, messagesRes, candidatesRes, inboundRes, remindersRes, discardsRes, jobsRes, loaded] = await Promise.all([
    db.from("prospects").select("*").eq("user_id", userId).is("deleted_at", null),
    db.from("messages").select("*").eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: false }),
    db.from("signal_candidates").select("*").eq("user_id", userId).eq("statut", "creusé").not("prospect_id", "is", null).limit(500),
    db.from("inbound_messages").select("*").eq("user_id", userId).eq("handled", false).is("deleted_at", null),
    db.from("reminders").select("prospect_id, due_at").eq("user_id", userId).eq("done", false),
    db.from("prospect_discards").select("*").eq("user_id", userId).is("undone_at", null),
    db.from("jobs").select("type, status, target").eq("user_id", userId).in("status", ["queued", "running"]),
    loadOffer(db, userId),
  ]);

  const prospects = new Map(((prospectsRes.data ?? []) as Prospect[]).map((row) => [row.id, row]));
  // Brouillons d'évaluation ou de script : jamais dans la file (filtre en
  // mémoire, la colonne `origin` peut précéder ou suivre ce code).
  const messages = ((messagesRes.data ?? []) as Row[]).filter((row) => !row.origin);
  const discards = (discardsRes.data ?? []) as ProspectDiscard[];
  const signature = signatureFor(loaded.offer);

  const discardFor = (match: (row: ProspectDiscard) => boolean) => discards.find(match) ?? null;
  const draftPending = new Set(
    ((jobsRes.data ?? []) as { type: string; target: { prospectId?: string } | null }[])
      .filter((job) => job.type === "email_generate")
      .map((job) => job.target?.prospectId)
      .filter(Boolean) as string[],
  );
  const latest = (prospectId: string, type: string) => messages.find((row) => row.prospect_id === prospectId && row.type === type) ?? null;
  const lastSent = (prospectId: string) => messages.find((row) => row.prospect_id === prospectId && row.status === "sent") ?? null;
  const alreadyContacted = (prospectId: string) => contactedProspect(messages, prospectId);
  // Un écart d'un jour précédent sort l'élément ; un écart du jour le laisse visible, barré.
  const classify = (discard: ProspectDiscard | null) => ({
    excluded: Boolean(discard && parisDay(discard.created_at) !== today),
    discardedToday: Boolean(discard && parisDay(discard.created_at) === today),
  });

  const raw: RawTodayItem[] = [];

  // 1. Réponses à traiter.
  for (const inbound of (inboundRes.data ?? []) as InboundMessage[]) {
    const draft = messages.find((row) => row.reply_to_inbound_id === inbound.id && row.status === "draft") ?? null;
    const state = classify(discardFor((row) => row.inbound_id === inbound.id));
    if (state.excluded) continue;
    raw.push(replyItem({ inbound, prospect: inbound.prospect_id ? prospects.get(inbound.prospect_id) ?? null : null, draft, signature, discardedToday: state.discardedToday }));
  }

  // 2. Relances dues aujourd'hui (hors week-end), dans le fil de l'envoi précédent.
  for (const reminder of (remindersRes.data ?? []) as { prospect_id: string; due_at: string }[]) {
    const prospect = prospects.get(reminder.prospect_id);
    const sent = prospect ? lastSent(prospect.id) : null;
    if (!prospect || !sent || !FOLLOWS_UP.has(prospect.status)) continue;
    if (offWeekend(new Date(reminder.due_at)) > endOfDay) continue;
    const type = NEXT_RELANCE[sent.type];
    if (!type) continue;
    const draft = latest(prospect.id, type);
    if (draft && !liveToday(draft, today)) continue;
    const state = classify(discardFor((row) => row.kind === "relance" && row.prospect_id === prospect.id && (!draft || row.message_id === draft.id)));
    if (state.excluded) continue;
    raw.push(relanceItem({ prospect, draft, signature, dueAt: reminder.due_at, lastSent: sent, followUpType: type, discardedToday: state.discardedToday, draftPending: draftPending.has(prospect.id) }));
  }

  // 3 et 4. Nouvelles fiches : celles de l'entonnoir, et les intros en attente.
  const candidates = new Map(((candidatesRes.data ?? []) as SignalCandidateRow[]).map((row) => [row.prospect_id as string, row]));
  const withIntroDraft = messages.filter((row) => row.type === "intro" && row.status === "draft").map((row) => row.prospect_id);
  for (const prospectId of new Set([...candidates.keys(), ...withIntroDraft])) {
    const prospect = prospects.get(prospectId);
    if (!prospect) continue;
    // DÉJÀ CONTACTÉ : jamais en intro. Il ne revient que par ses relances et
    // ses réponses (ARTFLEX : intro partie le 30/09, brouillon d'éval ensuite).
    if (alreadyContacted(prospectId)) continue;
    const intro = latest(prospectId, "intro");
    if (!liveToday(intro, today)) continue;
    if (!intro && !["nouveau", "a_contacter"].includes(prospect.status)) continue;
    const candidate = candidates.get(prospectId) ?? null;
    const state = classify(discardFor((row) => row.prospect_id === prospectId && (row.kind === "nouveau" || row.kind === "a_completer")));
    if (state.excluded) continue;
    const contact = (candidate?.contact ?? {}) as { attempts?: number; retried_at?: string };
    raw.push(prospectItem({
      prospect,
      card: candidate ? toCard(candidate, now) : null,
      draft: intro,
      signature,
      discardedToday: state.discardedToday,
      draftPending: draftPending.has(prospectId),
      attempts: contact.attempts ?? (contact.retried_at ? 1 : 0),
      weight: candidate?.weight ?? null,
    }));
  }

  return { today, groups: groupToday(raw) };
}
