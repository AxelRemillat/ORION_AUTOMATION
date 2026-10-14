/**
 * CONFORMITÉ DES BROUILLONS LIBRES (Cowork #59) — lecture seule par défaut, gratuit.
 *
 *   npx tsx scripts/fix-conformite-drafts.ts            # liste
 *   npx tsx scripts/fix-conformite-drafts.ts --apply    # corrige
 *
 * Deux retouches, rien d'autre :
 *   - la ligne d'opposition devient « <origine de l'adresse>. Un simple « stop »… » (lib/mail-preflight/contact-origin.ts) ;
 *   - sur une boîte de rôle (contact@, secretariat@…), « Bonjour Monsieur/Madame X, » devient « Bonjour, ».
 * Seulement les brouillons LIBRES : statut brouillon, ni validés, ni programmés, ni retouchés à la main, pas à la
 * corbeille. Le reste du texte est identique au caractère près (vérifié avant écriture).
 */
import { db, ownerId } from "./quality-live";
import { contactOriginOf, optOutSentence } from "@/lib/mail-preflight/contact-origin";
import { hasOptOut, OPT_OUT_SENTENCE } from "@/lib/mail-preflight/opt-out";
import { isRoleAddress } from "@/lib/contact-finder/extract";

const NAMED_GREETING = /^Bonjour (Monsieur|Madame)\b[^\n]*,$/;

function conformBody(body: string, email: string | null, origin: ReturnType<typeof contactOriginOf>): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((line) => hasOptOut(line));
  if (at >= 0 && lines[at].trim() === OPT_OUT_SENTENCE) lines[at] = optOutSentence(origin);
  if (isRoleAddress(email) && NAMED_GREETING.test(lines[0]?.trim() ?? "")) lines[0] = "Bonjour,";
  return lines.join("\n");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const userId = await ownerId();
  const loose = db as never as { from: (table: string) => any };
  const { data } = await loose
    .from("messages")
    .select("id, prospect_id, type, body")
    .eq("user_id", userId)
    .eq("status", "draft")
    .eq("send_status", "draft")
    .is("validated_at", null)
    .eq("edited_by_hand", false)
    .is("deleted_at", null)
    .in("type", ["intro", "relance_1", "relance_2"]);
  const rows = (data ?? []) as { id: string; prospect_id: string; type: string; body: string }[];
  const ids = [...new Set(rows.map((row) => row.prospect_id))];
  const { data: prospects } = ids.length
    ? await loose.from("prospects").select("id, company_name, email, contact_found_by, contact_source").in("id", ids)
    : { data: [] };
  const byId = new Map(((prospects ?? []) as { id: string; company_name: string; email: string | null; contact_found_by: string | null; contact_source: string | null }[]).map((p) => [p.id, p]));
  let line = 0;
  let greeting = 0;
  let written = 0;
  console.log(`${apply ? "CORRECTION" : "LECTURE SEULE"} — brouillons libres : ${rows.length}`);
  for (const row of rows) {
    const prospect = byId.get(row.prospect_id);
    if (!prospect) continue;
    const fixed = conformBody(row.body, prospect.email, contactOriginOf(prospect));
    if (fixed === row.body.replace(/\r\n/g, "\n")) continue;
    const before = row.body.replace(/\r\n/g, "\n").split("\n");
    const after = fixed.split("\n");
    const changed = before.map((text, index) => (text === after[index] ? null : index)).filter((index) => index !== null) as number[];
    // Garde : seules la salutation (ligne 1) et la ligne d'opposition changent.
    if (before.length !== after.length || changed.some((index) => index !== 0 && !hasOptOut(before[index]))) {
      console.log(`  ${row.id.slice(0, 8)} ${prospect.company_name} : autre changement — ignoré`);
      continue;
    }
    if (changed.includes(0)) greeting += 1;
    if (changed.some((index) => index !== 0)) line += 1;
    console.log(`  ${row.id.slice(0, 8)} ${row.type} ${prospect.company_name}${changed.includes(0) ? ` : « ${before[0]} » → « Bonjour, »` : ""}${changed.some((index) => index !== 0) ? ` : mention → « ${optOutSentence(contactOriginOf(prospect)).slice(0, 40)}… »` : ""}`);
    if (!apply) continue;
    const { data: updated } = await loose
      .from("messages")
      .update({ body: fixed })
      .eq("id", row.id)
      .eq("status", "draft")
      .eq("send_status", "draft")
      .is("validated_at", null)
      .eq("edited_by_hand", false)
      .select("id");
    written += updated?.length ?? 0;
  }
  console.log(`\nMention avec origine : ${line} · salutation « Bonjour, » sur boîte de rôle : ${greeting}${apply ? ` · écrits : ${written}` : ""}.`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
