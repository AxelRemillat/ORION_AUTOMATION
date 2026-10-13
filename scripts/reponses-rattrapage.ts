/**
 * RATTRAPAGE DES RÉPONSES DÉJÀ REÇUES (Cowork #51) — en local, contre la base.
 * Pour chaque mail reçu : rattachement (adresse, fil, domaine) s'il n'en a pas,
 * puis classement du refus (règles ; l'ambigu est listé, pas tranché).
 *
 *   npm run reponses:rattrapage                         → simulation (liste, rien n'est écrit)
 *   npm run reponses:rattrapage -- --only <inboundId> --apply  → applique à CE mail seulement
 *
 * Aucun envoi, aucune suppression. Les réponses automatiques (absence, anti-spam) sont ignorées.
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { findProspectForInbound, withSecondaryContact } from "@/lib/inbound/attach";
import { classifyRefusal } from "@/lib/inbound/refusal";
import { applyRefusal } from "@/lib/inbound/refusal-server";
import { autoReplyKind } from "@/lib/inbound/auto-reply";
import { recordProspectEvent } from "@/lib/history/record";
import type { Db } from "@/lib/trash/scope";

const value = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const APPLY = process.argv.includes("--apply");
const ONLY = value("--only");

type Row = { id: string; prospect_id: string | null; from_email: string; subject: string | null; body: string; category: string; thread_id: string | null; received_at: string };

async function main() {
  if (APPLY && !ONLY) throw new Error("--apply exige --only <inboundId> : le rattrapage s'applique mail par mail.");
  const userId = await ownerId();
  const rows = await readAll<Row>(() =>
    db.from("inbound_messages").select("id, prospect_id, from_email, subject, body, category, thread_id, received_at").eq("user_id", userId).is("deleted_at", null).order("id"),
  );
  console.log(`${rows.length} mail(s) reçu(s) examinés${APPLY ? ` — APPLICATION à ${ONLY}` : " — SIMULATION"}`);
  for (const row of rows) {
    if (ONLY && row.id !== ONLY) continue;
    if (autoReplyKind(row)) continue;
    const found = row.prospect_id
      ? { prospect: (await db.from("prospects").select("id, user_id, status, deleted_at, company_name, email, key_figures").eq("id", row.prospect_id).maybeSingle()).data, via: "déjà rattaché" }
      : await findProspectForInbound(db as unknown as Db, { fromEmail: row.from_email, threadId: row.thread_id });
    const prospect = found?.prospect as { id: string; status: string; company_name: string; deleted_at?: string | null; key_figures?: Record<string, unknown> | null } | null;
    const kind = classifyRefusal(row.body);
    const changes = [
      !row.prospect_id && prospect ? `rattaché à ${prospect.company_name} (${found!.via})` : null,
      prospect && (kind === "refus" || kind === "stop") && row.category !== "refus" ? `${kind} → Perdu${kind === "stop" ? " + ne plus contacter" : ""} (était ${prospect.status})` : null,
      kind === "ambigu" ? "ambigu (à relire)" : null,
      kind === "plus_tard" ? "report (statut inchangé)" : null,
    ].filter(Boolean);
    if (!changes.length) continue;
    console.log(`  · ${row.id} · ${row.from_email} · « ${(row.subject ?? "").slice(0, 50)} » → ${changes.join(" ; ")}`);
    if (!APPLY || !prospect || prospect.deleted_at) continue;

    if (!row.prospect_id) {
      await db.from("inbound_messages").update({ prospect_id: prospect.id }).eq("id", row.id).eq("user_id", userId);
      const figures = withSecondaryContact(prospect.key_figures, { email: row.from_email, via: found!.via as "fil" | "domaine", at: row.received_at });
      if (figures) {
        await db.from("prospects").update({ key_figures: figures } as never).eq("id", prospect.id).eq("user_id", userId);
        prospect.key_figures = figures;
        await recordProspectEvent(db, { prospectId: prospect.id, userId, kind: "contact", data: { title: `Réponse de ${row.from_email} rattachée (${found!.via}) : contact secondaire ajouté` } });
      }
    }
    if (kind === "refus" || kind === "stop") {
      const out = await applyRefusal(db as unknown as Db, { userId, prospect: { id: prospect.id, status: prospect.status, key_figures: prospect.key_figures }, inbound: { id: row.id, category: row.category, received_at: row.received_at, body: row.body }, kind });
      console.log(`    appliqué : ${out.applied ? "oui" : "non"}`);
    }
  }
  console.log(APPLY ? "Fait." : "SIMULATION : relancer avec --only <id> --apply.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
