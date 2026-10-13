"use server";

import { createClient } from "@/lib/supabase/server";
import type { Db } from "@/lib/trash/scope";
import { TEST_PAYLOAD } from "./payload";
import { pushToDevices } from "./send";

/**
 * Réglages › Paramètres › Notifications sur cet appareil (Cowork #28) :
 * abonner, désabonner, tester. « Désactiver » pose `disabled_at` : aucune
 * ligne supprimée. La clé publique VAPID est lue côté page, jamais la privée.
 */
type Result = { ok: true } | { ok: false; error: string };

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

async function session() {
  const db = createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return { db: db as unknown as { from: (table: string) => any }, userId: user?.id ?? null };
}

export async function subscribePush(subscription: BrowserSubscription, userAgent: string | null): Promise<Result> {
  const { db, userId } = await session();
  if (!userId) return { ok: false, error: "Session expirée. Reconnectez-vous." };
  const { endpoint, keys } = subscription ?? {};
  if (!endpoint?.startsWith("https://") || !keys?.p256dh || !keys?.auth) return { ok: false, error: "Abonnement du navigateur invalide." };
  const { error } = await db.from("push_subscriptions").upsert(
    { user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: userAgent?.slice(0, 300) ?? null, updated_at: new Date().toISOString(), disabled_at: null },
    { onConflict: "endpoint" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function unsubscribePush(endpoint: string): Promise<Result> {
  const { db, userId } = await session();
  if (!userId) return { ok: false, error: "Session expirée. Reconnectez-vous." };
  const { error } = await db.from("push_subscriptions").update({ disabled_at: new Date().toISOString() }).eq("endpoint", endpoint).eq("user_id", userId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Notification de test vers les appareils abonnés : aucun mail, aucun anti-doublon. */
export async function testPush(): Promise<Result> {
  const { db, userId } = await session();
  if (!userId) return { ok: false, error: "Session expirée. Reconnectez-vous." };
  const outcome = await pushToDevices(db as unknown as Db, userId, null, TEST_PAYLOAD);
  if (outcome.sent) return { ok: true };
  const reasons = { "not-configured": "Notifications non configurées (clés VAPID absentes).", "no-subscription": "Aucun appareil abonné : cliquez d'abord sur « Activer ».", duplicate: "Déjà envoyée.", error: "Le service de notification a refusé l'envoi (voir les logs Vercel)." };
  return { ok: false, error: reasons[outcome.reason ?? "error"] };
}
