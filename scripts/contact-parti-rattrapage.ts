/**
 * RATTRAPAGE « CONTACT PARTI » (Cowork #54) — en local, contre la base.
 * Les réponses déjà reçues, corbeille COMPRISE (un mail mis à la corbeille
 * n'a pas fait revivre l'adresse), reclassées par la règle actuelle.
 *
 *   npm run contacts:partis              → simulation (liste, rien n'est écrit)
 *   npm run contacts:partis -- --apply   → relances vers l'adresse partie annulées,
 *                                          adresse marquée, contacts proposés
 *
 * Aucun envoi, aucune suppression, aucune relance reprogrammée, aucun appel Hunter.
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { autoReplyKind } from "@/lib/inbound/auto-reply";
import { proposedContacts } from "@/lib/inbound/departed";
import { applyDeparted } from "@/lib/inbound/departed-server";
import { findProspectForInbound } from "@/lib/inbound/attach";
import type { Db } from "@/lib/trash/scope";

const APPLY = process.argv.includes("--apply");

type Row = { id: string; prospect_id: string | null; from_email: string; subject: string | null; body: string; received_at: string; thread_id: string | null; deleted_at: string | null };

async function main() {
  const userId = await ownerId();
  const rows = await readAll<Row>(() =>
    db.from("inbound_messages").select("id, prospect_id, from_email, subject, body, received_at, thread_id, deleted_at").eq("user_id", userId).order("id"),
  );
  const departed = rows.filter((row) => autoReplyKind(row) === "parti");
  console.log(`${rows.length} mail(s) reçu(s), dont ${departed.length} « contact parti »${APPLY ? " — APPLICATION" : " — SIMULATION"}`);
  let cancelled = 0;
  for (const row of departed) {
    const found = row.prospect_id
      ? { prospect: (await db.from("prospects").select("id, email, company_name, deleted_at, key_figures").eq("id", row.prospect_id).maybeSingle()).data as { id: string; email: string | null; company_name: string; deleted_at: string | null; key_figures: Record<string, unknown> | null } | null }
      : await findProspectForInbound(db as unknown as Db, { fromEmail: row.from_email, threadId: row.thread_id });
    const prospect = found?.prospect as { id: string; email: string | null; company_name: string; deleted_at?: string | null; key_figures: Record<string, unknown> | null } | null;
    const proposals = proposedContacts(row.body, { domain: row.from_email.split("@")[1] ?? null, departedEmail: row.from_email });
    console.log(`  · ${prospect?.company_name ?? "non rattaché"} · ${row.from_email}${row.deleted_at ? " (mail à la corbeille)" : ""} · ${proposals.length} contact(s) proposé(s) : ${proposals.map((item) => `${item.name ?? "?"} — ${item.role ?? "?"}${item.suggested ? " [suggéré]" : ""}`).join(" ; ") || "—"}`);
    if (!APPLY || !prospect || prospect.deleted_at) continue;
    const out = await applyDeparted(db as unknown as Db, { userId, prospect: { id: prospect.id, email: prospect.email, key_figures: prospect.key_figures ?? null }, inbound: { id: row.id, from_email: row.from_email, body: row.body, received_at: row.received_at } });
    cancelled += out.cancelled;
    console.log(`    appliqué : ${out.cancelled} relance(s) annulée(s), ${out.proposed.length} nouveau(x) contact(s) proposé(s)`);
  }
  console.log(APPLY ? `Fait. Relances annulées : ${cancelled}.` : "SIMULATION : relancer avec --apply.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
