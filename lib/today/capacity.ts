import { buildDeliverability, DELIVERABILITY_COLUMNS, type SentRow } from "@/lib/outbox/deliverability";
import { utcToParis } from "@/lib/outbox/paris-time";
import type { Db } from "@/lib/trash/scope";
import { businessDays, sendDay, type DayRoom } from "./plan";
import { parisToUtc } from "@/lib/outbox/paris-time";
import { readAllResult } from "@/lib/supabase/read-all";

/**
 * Ce que la programmation groupée peut encore placer sur le jour d'envoi :
 * plafond de montée en charge − envoyés ce jour − déjà programmés ce jour.
 * Les créneaux déjà pris sont rendus pour que le plan ne s'y superpose pas.
 */
export interface Capacity {
  day: string;
  dailyCap: number;
  sentToday: number;
  /**
   * Envois DÉJÀ PROGRAMMÉS sur le jour d'envoi. Ils occupent le plafond autant
   * que des envois partis : sans eux à l'écran, « 16/25 » laissait croire à
   * neuf places libres alors que `remaining` valait 0 (09/10/2026).
   */
  plannedToday: number;
  remaining: number;
  warmupDay: number | null;
  /** Instants ISO des envois déjà programmés. */
  taken: string[];
  /**
   * Place des 5 prochains jours ouvrés (Cowork #50), aujourd'hui compris s'il est ouvré : plafond de montée en
   * charge de CE jour, envoyés + programmés ce jour déduits.
   */
  days: DayRoom[];
}

/** Horizon maximal de la programmation groupée, en jours ouvrés. */
export const PLAN_HORIZON_DAYS = 5;

export async function loadCapacity(db: Db, userId: string, now = new Date()): Promise<Capacity> {
  const [sentRes, plannedRes] = await Promise.all([
    // Tous les envois, page par page (Cowork #24) : le plafond du jour en dépend.
    readAllResult(() => db.from("messages").select(DELIVERABILITY_COLUMNS).eq("user_id", userId).eq("status", "sent").order("id")),
    db.from("messages").select("scheduled_at").eq("user_id", userId).in("send_status", ["scheduled", "sending"]).is("deleted_at", null),
  ]);
  const deliverability = buildDeliverability((sentRes.data ?? []) as unknown as SentRow[], now);
  const day = sendDay(now);
  const taken = ((plannedRes.data ?? []) as { scheduled_at: string | null }[])
    .map((row) => row.scheduled_at)
    .filter((at): at is string => Boolean(at));
  const plannedThatDay = taken.filter((at) => utcToParis(new Date(at)).date === day).length;
  const sentThatDay = day === utcToParis(now).date ? deliverability.sentToday : 0;
  const sentRows = (sentRes.data ?? []) as unknown as SentRow[];
  const today = utcToParis(now).date;
  const days = businessDays(now, PLAN_HORIZON_DAYS).map((date) => {
    // Plafond du jour concerné : la montée en charge avance avec les jours ouvrés.
    const noon = parisToUtc(date, "12:00") ?? now;
    const cap = date === today ? deliverability.dailyCap : buildDeliverability(sentRows, noon).dailyCap;
    const sent = date === today ? deliverability.sentToday : 0;
    return { day: date, cap, used: sent + taken.filter((at) => utcToParis(new Date(at)).date === date).length };
  });
  return {
    day,
    days,
    dailyCap: deliverability.dailyCap,
    sentToday: deliverability.sentToday,
    plannedToday: plannedThatDay,
    remaining: Math.max(0, deliverability.dailyCap - sentThatDay - plannedThatDay),
    warmupDay: deliverability.warmupDay,
    taken,
  };
}
