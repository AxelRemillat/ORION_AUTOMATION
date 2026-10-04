import { isBounce } from "./volumes";

/**
 * Prochaine marche de volume (Réglages › Délivrabilité) — AFFICHAGE seulement :
 * la montée en charge automatique reste celle de lib/outbox/deliverability.ts.
 * La marche visée par Axel (20 mails par jour) n'est raisonnable que si la
 * réputation tient : conditions vérifiées sur les données réelles.
 */

export const NEXT_DAILY_STEP = 20;
export const MIN_SENDS_FOR_STEP = 50;
export const MAX_STOP_RATE = 0.01;

export interface RampCondition {
  label: string;
  ok: boolean;
  detail: string;
}

export interface RampInbound {
  from_email: string;
  subject?: string | null;
  body?: string | null;
  category?: string | null;
  received_at: string;
}

const isStop = (message: RampInbound) => message.category === "refus" || /^\s*stop\b/i.test(message.body ?? "") || /^\s*stop\b/i.test(message.subject ?? "");

export function nextRampStep(input: {
  currentCap: number;
  sentTotal: number;
  inbound: readonly RampInbound[];
  dnsOk: { spf: boolean; dkim: boolean };
  now?: Date;
}): { target: number; current: number; ready: boolean; conditions: RampCondition[] } {
  const now = (input.now ?? new Date()).getTime();
  const hardBounces7 = input.inbound.filter((message) => isBounce(message) && now - Date.parse(message.received_at) <= 7 * 86_400_000).length;
  const stops = input.inbound.filter(isStop).length;
  const stopRate = input.sentTotal ? stops / input.sentTotal : 0;
  const conditions: RampCondition[] = [
    { label: "0 rebond dur sur 7 jours", ok: hardBounces7 === 0, detail: `${hardBounces7} rebond(s) sur les 7 derniers jours` },
    {
      label: "Moins de 1 % de « stop »",
      ok: input.sentTotal > 0 && stopRate < MAX_STOP_RATE,
      detail: input.sentTotal ? `${stops} « stop » sur ${input.sentTotal} envois (${(stopRate * 100).toFixed(1).replace(".", ",")} %)` : "aucun envoi encore",
    },
    { label: "SPF et DKIM en place", ok: input.dnsOk.spf && input.dnsOk.dkim, detail: `SPF ${input.dnsOk.spf ? "ok" : "à corriger"}, DKIM ${input.dnsOk.dkim ? "ok" : "à corriger"}` },
    {
      label: `Au moins ${MIN_SENDS_FOR_STEP} envois cumulés`,
      ok: input.sentTotal >= MIN_SENDS_FOR_STEP,
      detail: `${input.sentTotal} envoi(s) : en dessous, les taux ne disent encore rien`,
    },
  ];
  const target = Math.max(NEXT_DAILY_STEP, input.currentCap + 5);
  return { target, current: input.currentCap, ready: conditions.every((condition) => condition.ok), conditions };
}
