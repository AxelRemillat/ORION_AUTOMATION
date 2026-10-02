import { buildDeliverability, DELIVERABILITY_COLUMNS, type SentRow } from "@/lib/outbox/deliverability";
import { utcToParis } from "@/lib/outbox/paris-time";
import type { Db } from "@/lib/trash/scope";
import { sendDay } from "./plan";

/**
 * Ce que la programmation groupée peut encore placer sur le jour d'envoi :
 * plafond de montée en charge − envoyés ce jour − déjà programmés ce jour.
 * Les créneaux déjà pris sont rendus pour que le plan ne s'y superpose pas.
 */
export interface Capacity {
  day: string;
  dailyCap: number;
  sentToday: number;
  remaining: number;
  warmupDay: number | null;
  /** Instants ISO des envois déjà programmés. */
  taken: string[];
}

export async function loadCapacity(db: Db, userId: string, now = new Date()): Promise<Capacity> {
  const [sentRes, plannedRes] = await Promise.all([
    db.from("messages").select(DELIVERABILITY_COLUMNS).eq("user_id", userId).eq("status", "sent"),
    db.from("messages").select("scheduled_at").eq("user_id", userId).in("send_status", ["scheduled", "sending"]).is("deleted_at", null),
  ]);
  const deliverability = buildDeliverability((sentRes.data ?? []) as unknown as SentRow[], now);
  const day = sendDay(now);
  const taken = ((plannedRes.data ?? []) as { scheduled_at: string | null }[])
    .map((row) => row.scheduled_at)
    .filter((at): at is string => Boolean(at));
  const plannedThatDay = taken.filter((at) => utcToParis(new Date(at)).date === day).length;
  const sentThatDay = day === utcToParis(now).date ? deliverability.sentToday : 0;
  return {
    day,
    dailyCap: deliverability.dailyCap,
    sentToday: deliverability.sentToday,
    remaining: Math.max(0, deliverability.dailyCap - sentThatDay - plannedThatDay),
    warmupDay: deliverability.warmupDay,
    taken,
  };
}
