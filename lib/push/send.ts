import webpush from "web-push";
import type { Db } from "@/lib/trash/scope";
import { vapidConfig, type VapidConfig } from "./config";
import type { PushPayload } from "./payload";
/** Tables hors du schéma typé (push_subscriptions est neuve) : accès non typé, comme lib/badges/counts.ts. */
const from = (db: Db, table: string) => (db as unknown as { from: (name: string) => any }).from(table);

/**
 * ENVOI WEB PUSH (Cowork #28) — vers chaque appareil abonné d'Axel.
 *
 *   - Clés VAPID absentes : rien n'est fait (« not-configured »), rien ne casse.
 *   - Anti-doublon : une notification par événement (`notification_log`, clé
 *     « webpush:<événement> », la clé primaire refuse la seconde).
 *   - Abonnement expiré (404 / 410) : `disabled_at` posé, la ligne reste.
 *   - Ne lève JAMAIS : un push raté ne bloque ni la réception d'un mail ni
 *     l'ingestion d'une offre. Le ntfy du téléphone reste en place, à côté.
 *   - Anti-rafale : le service worker (public/orion-sw.js) regroupe les
 *     événements arrivés en moins d'une minute en une seule notification.
 */
export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}
/** Envoi d'un message chiffré vers un abonnement ; lève une erreur portant `statusCode` en cas de refus. */
export type PushSender = (subscription: PushSubscriptionRow, payload: string, config: VapidConfig) => Promise<unknown>;

export interface PushDeps {
  /** Par défaut la bibliothèque `web-push` (chiffrement RFC 8291 + jeton VAPID). */
  sender?: PushSender;
  /** Par défaut les variables VAPID_* ; `null` = non configuré. */
  config?: VapidConfig | null;
  now?: () => Date;
}

export type PushOutcome = { sent: number; reason?: "not-configured" | "duplicate" | "no-subscription" | "error" };

const webPushSender: PushSender = (subscription, payload, config) =>
  webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, {
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
    TTL: 4 * 3600,
    urgency: "high",
  });
const statusOf = (error: unknown) => (error as { statusCode?: number } | null)?.statusCode ?? null;
/**
 * Pousse `payload` sur les appareils actifs de `userId`. `key` = l'événement
 * (« reply:<id> », « opportunite:<id> ») pour l'anti-doublon ; `null` pour un
 * test, qui passe toujours.
 */
export async function pushToDevices(db: Db, userId: string, key: string | null, payload: PushPayload, deps: PushDeps = {}): Promise<PushOutcome> {
  try {
    const config = deps.config === undefined ? vapidConfig() : deps.config;
    if (!config) return { sent: 0, reason: "not-configured" };
    if (key) {
      const { error } = await from(db, "notification_log").insert({ key: `webpush:${key}`, user_id: userId, kind: "webpush" });
      // 23505 : déjà poussé. Autre erreur (journal indisponible) : on pousse quand même.
      if ((error as { code?: string } | null)?.code === "23505") return { sent: 0, reason: "duplicate" };
    }
    const { data } = await from(db, "push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId).is("disabled_at", null);
    const subscriptions = (data ?? []) as PushSubscriptionRow[];
    if (!subscriptions.length) return { sent: 0, reason: "no-subscription" };
    const body = JSON.stringify(payload);
    const sender = deps.sender ?? webPushSender;
    const now = (deps.now ?? (() => new Date()))().toISOString();
    let sent = 0;
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await sender(subscription, body, config);
          sent += 1;
        } catch (error) {
          const status = statusOf(error);
          // L'appareil s'est désabonné (ou le navigateur a été réinitialisé) : on n'y pousse plus.
          if (status === 404 || status === 410) await from(db, "push_subscriptions").update({ disabled_at: now }).eq("id", subscription.id);
          else console.warn(`[web-push] notification non envoyée${status ? ` (HTTP ${status})` : ""}`);
        }
      }),
    );
    return sent ? { sent } : { sent: 0, reason: "error" };
  } catch {
    return { sent: 0, reason: "error" };
  }
}
