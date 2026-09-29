/**
 * Les mails programmés passeraient-ils le contrôle avant envoi ? LECTURE
 * SEULE : rien n'est modifié, déplacé ni envoyé (les relances du 2 oct.
 * restent telles quelles). Sert à corriger à temps, depuis « Programmés »,
 * ce que le tick bloquerait.
 *
 *   npx tsx scripts/preflight-scheduled.ts
 *
 * Lit `.env.local` (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE). N'affiche
 * aucune clé ; affiche entreprise, type, heure, destinataire et verdict.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { preflightFor } from "../lib/outbox/send";
import { replySinceLastSend } from "../lib/outbox/relances";
import { formatParisDateTime } from "../lib/outbox/paris-time";
import { inSendWindow } from "../lib/mail-preflight/schedule";
import type { Db } from "../lib/trash/scope";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

(async () => {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis dans .env.local");
  const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as Db;

  const { data, error } = await db
    .from("messages")
    .select("id, user_id, prospect_id, type, subject, body, status, scheduled_at, scheduled_to, send_status")
    .in("send_status", ["scheduled", "blocked"])
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(error.message);

  let blocked = 0;
  for (const message of (data ?? []) as Record<string, string>[]) {
    const { data: prospect } = await db
      .from("prospects")
      .select("company_name, email, key_figures, website")
      .eq("id", message.prospect_id)
      .maybeSingle();
    const check = await preflightFor(db, message as never, message.scheduled_to, prospect as never);
    const replied = message.type.startsWith("relance") ? await replySinceLastSend(db, message.user_id, message.prospect_id) : null;
    const window = message.scheduled_at && !inSendWindow(new Date(message.scheduled_at)) ? " (hors 8h–18h ouvrés : partira à la réouverture)" : "";
    const ok = check.ok && !replied;
    if (!ok) blocked += 1;
    console.log(`\n${ok ? "✅" : "❌"} ${(prospect as { company_name?: string } | null)?.company_name ?? message.prospect_id} · ${message.type} · ${formatParisDateTime(message.scheduled_at)}${window} → ${message.scheduled_to}`);
    console.log(`   objet : ${message.subject}`);
    for (const reason of check.errors) console.log(`   ❌ ${reason}`);
    if (replied) console.log(`   ❌ le prospect a répondu (${replied.slice(0, 10)}) : la relance serait refusée`);
    for (const warning of check.warnings) console.log(`   ⚠️  ${warning}`);
  }
  console.log(`\n${data?.length ?? 0} mail(s) programmé(s), ${blocked} seraient bloqués au départ.`);
})().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
