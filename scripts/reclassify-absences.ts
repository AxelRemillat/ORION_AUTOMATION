/**
 * ABSENCES CLASSÉES « RÉPONSE » À TORT (Cowork #49, LSO MEDICAL 12/10).
 *
 *   npx tsx scripts/reclassify-absences.ts            # lecture seule : liste
 *   npx tsx scripts/reclassify-absences.ts --apply    # reclasse
 *   npx tsx scripts/reclassify-absences.ts --days 30  # fenêtre (14 jours par défaut)
 *
 * Rejoue la détection (lib/inbound/auto-reply.ts) sur les mails reçus de la fenêtre et, pour chaque absence encore
 * traitée comme une réponse : catégorie n8n → « autre », fiche « Répondu » → statut du dernier envoi, rappel de
 * relance rouvert (au lendemain du retour si la date est lisible). Aucun envoi, aucune suppression, aucune relance
 * reprogrammée. Gratuit (aucun appel modèle).
 */
import { db, ownerId } from "./quality-live";
import { autoReplyKind } from "@/lib/inbound/auto-reply";
import { reclassifyAbsence } from "@/lib/inbound/auto-reply-server";

const paris = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

async function main() {
  const apply = process.argv.includes("--apply");
  const daysArg = process.argv.indexOf("--days");
  const days = daysArg > 0 ? Number(process.argv[daysArg + 1]) || 14 : 14;
  const userId = await ownerId();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const loose = db as never as { from: (table: string) => any };
  const { data: inbound } = await loose
    .from("inbound_messages")
    .select("id, prospect_id, from_email, subject, body, category, received_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("received_at", since)
    .order("received_at");
  const absences = ((inbound ?? []) as { id: string; prospect_id: string | null; from_email: string; subject: string | null; body: string | null; category: string; received_at: string }[]).filter(
    (row) => autoReplyKind(row) === "absence",
  );
  console.log(`${apply ? "RECLASSEMENT" : "LECTURE SEULE"} — absences reçues depuis ${days} jours : ${absences.length}`);
  console.log("| Reçu | Fiche | Catégorie n8n | Statut rétabli | Prochaine relance | Relances remises en brouillon |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  let touched = 0;
  for (const row of absences) {
    const result = await reclassifyAbsence(db as never, { userId, inboundId: row.id, apply });
    if (!result) continue;
    const { data: prospect } = row.prospect_id ? await loose.from("prospects").select("company_name").eq("id", row.prospect_id).maybeSingle() : { data: null };
    const changes = Boolean(result.categoryFrom || result.statusRestored || result.followUpAt);
    if (changes) touched += 1;
    console.log(
      `| ${paris(row.received_at)} | ${(prospect as { company_name?: string } | null)?.company_name ?? "non rattaché"} | ${result.categoryFrom ? `${result.categoryFrom} → autre` : row.category} | ${result.statusRestored ? `Répondu → ${result.statusRestored}` : "—"} | ${result.followUpAt ? `${paris(result.followUpAt)}${result.returnDate ? ` (retour ${result.returnDate})` : ""}` : "—"} | ${result.cancelledDrafts || "—"} |`,
    );
  }
  console.log(`\n${touched} absence(s) ${apply ? "reclassée(s)" : "à reclasser"}. Aucun envoi, aucune suppression, aucune relance reprogrammée.`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
