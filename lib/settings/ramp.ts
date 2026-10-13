import { isBounce } from "./volumes";
import { MAX_DAILY_CAP, WARMUP_STEPS } from "@/lib/outbox/deliverability";

/**
 * Prochaine marche de volume (Réglages › Délivrabilité) — AFFICHAGE : le plafond
 * appliqué reste celui de lib/outbox/deliverability.ts.
 *
 * Plan validé avec Axel le 13/10/2026 (Cowork #26) : 25 → 30 (le 16/10, automatique,
 * si les métriques tiennent) → 40 (fin octobre, après DEUX SEMAINES PROPRES à 30) → 50,
 * le maximum sur cette boîte. 40 et 50 ne sont jamais automatiques : Axel les débloque
 * (SEND_DAILY_CAP_UNLOCKED) quand les conditions affichées ici sont réunies.
 */

export const MIN_SENDS_FOR_STEP = 50;
export const MAX_STOP_RATE = 0.01;
/** « Deux semaines propres » : 10 jours ouvrés au palier courant. */
export const CLEAN_DAYS_FOR_MANUAL_STEP = 10;
/** Jour de montée en charge où le palier automatique de 30 commence (le 16/10/2026). */
export const AUTO_30_FROM_DAY = (WARMUP_STEPS.at(-2)?.untilDay ?? 14) + 1;

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

/** Palier suivant de l'échelle 25 → 30 → 40 → 50, ou `null` au maximum. */
export function nextCap(current: number): number | null {
  const ladder = [10, 15, 25, 30, 40, MAX_DAILY_CAP];
  return ladder.find((cap) => cap > current) ?? null;
}

export interface RampStep {
  current: number;
  /** Palier suivant (`null` : 50, le maximum sur cette boîte). */
  target: number | null;
  /** Le palier suivant vient seul (montée en charge) ou se débloque à la main. */
  automatic: boolean;
  /** Quand / comment : « le 16/10 (jour 15) » ou « à débloquer : SEND_DAILY_CAP_UNLOCKED=40 ». */
  how: string;
  ready: boolean;
  conditions: RampCondition[];
}

export function nextRampStep(input: {
  currentCap: number;
  warmupDay?: number | null;
  sentTotal: number;
  inbound: readonly RampInbound[];
  dnsOk: { spf: boolean; dkim: boolean };
  now?: Date;
}): RampStep {
  const now = (input.now ?? new Date()).getTime();
  const target = nextCap(input.currentCap);
  const automatic = target !== null && target <= 30;
  // Palier manuel (40, 50) : deux semaines propres → 14 jours de recul sur les rebonds.
  const window = automatic ? 7 : 14;
  const hardBounces = input.inbound.filter((message) => isBounce(message) && now - Date.parse(message.received_at) <= window * 86_400_000).length;
  const stops = input.inbound.filter(isStop).length;
  const stopRate = input.sentTotal ? stops / input.sentTotal : 0;
  const conditions: RampCondition[] = [
    { label: `0 rebond dur sur ${window} jours`, ok: hardBounces === 0, detail: `${hardBounces} rebond(s) sur les ${window} derniers jours` },
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
  if (!automatic && target !== null) {
    const daysAtCap = input.warmupDay == null ? 0 : Math.max(0, input.warmupDay - AUTO_30_FROM_DAY + 1);
    conditions.push({
      label: `Deux semaines propres à ${input.currentCap} (${CLEAN_DAYS_FOR_MANUAL_STEP} jours ouvrés)`,
      ok: daysAtCap >= CLEAN_DAYS_FOR_MANUAL_STEP,
      detail: `${daysAtCap} jour(s) ouvré(s) à ${input.currentCap} par jour`,
    });
  }
  const how =
    target === null
      ? `${MAX_DAILY_CAP} par jour : le maximum sur cette boîte`
      : automatic
        ? input.warmupDay != null && input.warmupDay < AUTO_30_FROM_DAY
          ? `automatique au jour ${AUTO_30_FROM_DAY} de montée en charge (dans ${AUTO_30_FROM_DAY - input.warmupDay} jour(s) ouvré(s)), si les métriques tiennent`
          : "automatique, si les métriques tiennent"
        : `jamais automatique : à débloquer (SEND_DAILY_CAP_UNLOCKED=${target}) quand tout est vert`;
  return { current: input.currentCap, target, automatic, how, ready: target !== null && conditions.every((condition) => condition.ok), conditions };
}
