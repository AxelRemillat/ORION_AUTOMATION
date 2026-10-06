"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { appUrl, notifyConfigured, pushNtfy, type NotifyPrefs } from "./ntfy";

/** Réglages › Paramètres : interrupteurs des notifications téléphone, et test. */

type Result = { ok: true } | { ok: false; error: string };

async function currentUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  return user?.id ?? null;
}

export async function saveNotifyPrefs(prefs: NotifyPrefs): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Session expirée. Reconnectez-vous." };
  const { error } = await createClient()
    .from("notification_prefs")
    .upsert(
      { user_id: userId, reply: Boolean(prefs.reply), antispam: Boolean(prefs.antispam), send_failed: Boolean(prefs.send_failed), updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/reglages/parametres");
  return { ok: true };
}

/** Notification de test : ignore les interrupteurs et l'anti-doublon, aucun mail envoyé. */
export async function sendTestNotification(): Promise<Result> {
  if (!(await currentUserId())) return { ok: false, error: "Session expirée. Reconnectez-vous." };
  if (!notifyConfigured()) return { ok: false, error: "NTFY_TOPIC n'est pas configuré sur ce déploiement." };
  const sent = await pushNtfy({
    title: "Test ORION",
    body: "Les notifications ORION arrivent bien sur ce téléphone.",
    priority: "default",
    tags: ["white_check_mark"],
    click: `${appUrl()}/cockpit`,
  });
  return sent ? { ok: true } : { ok: false, error: "ntfy n'a pas accepté la notification (voir les logs Vercel)." };
}
