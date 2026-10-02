"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setDoNotContact } from "@/lib/outbox/do-not-contact";
import { INTEGRATIONS, type IntegrationKey, type TestResult } from "@/lib/settings/integrations";
import { testIntegration } from "@/lib/settings/integrations-server";

/**
 * Actions de Réglages. Session de l'utilisateur ; aucune n'efface quoi que ce
 * soit — « ne plus contacter » ne fait qu'ajouter un prospect à la liste.
 */

async function signedIn() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? supabase : null;
}

/** « Tester » : un appel GRATUIT au service ; rien pour les webhooks n8n. */
export async function testIntegrationAction(key: IntegrationKey): Promise<TestResult> {
  const db = await signedIn();
  if (!db) return { ok: false, detail: "Session expirée." };
  if (!INTEGRATIONS.some((item) => item.key === key && item.test)) return { ok: false, detail: "Pas de test sans coût pour ce service." };
  return (await testIntegration(key, { db })) ?? { ok: false, detail: "Pas de test sans coût pour ce service." };
}

/** Ajout manuel à « ne plus contacter » (jamais de retrait en masse ici). */
export async function addDoNotContact(prospectId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await signedIn();
  if (!db) return { ok: false, error: "Session expirée." };
  const result = await setDoNotContact(db, prospectId, true);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/reglages/delivrabilite");
  return { ok: true };
}
