/**
 * LIENS DE DÉMO SANS v= DANS LES BROUILLONS (Cowork #58) — lecture seule par défaut, gratuit.
 *
 *   npx tsx scripts/fix-demo-links.ts            # liste
 *   npx tsx scripts/fix-demo-links.ts --apply    # corrige
 *
 * Ajoute `v=` (famille du brouillon, sinon 0) aux liens de démo des brouillons LIBRES : statut brouillon, ni
 * validés, ni programmés, ni retouchés à la main, pas à la corbeille. SEUL le lien change : le reste du texte est
 * identique au caractère près (vérifié avant écriture). Jamais un mail validé, programmé ou parti.
 */
import { db, ownerId } from "./quality-live";
import { ensureDemoV, type MailFamily } from "@/lib/emails/quality/families";

const UNMARKED = /axelremillat\.com\/(?:automatisations|agent|pipeline|demos)\b[^\s)»"<>]*/g;
const hasUnmarked = (body: string) => (body.match(UNMARKED) ?? []).some((link) => !/[?&]v=[^&\s]+/.test(link.replace(/[.,;:!?]+$/, "")));

async function main() {
  const apply = process.argv.includes("--apply");
  const userId = await ownerId();
  const loose = db as never as { from: (table: string) => any };
  const { data } = await loose
    .from("messages")
    .select("id, prospect_id, type, body, status, send_status, validated_at, edited_by_hand")
    .eq("user_id", userId)
    .eq("status", "draft")
    .eq("send_status", "draft")
    .is("validated_at", null)
    .eq("edited_by_hand", false)
    .is("deleted_at", null)
    .ilike("body", "%axelremillat.com/%");
  const todo = ((data ?? []) as { id: string; type: string; body: string }[]).filter((row) => hasUnmarked(row.body));
  console.log(`${apply ? "CORRECTION" : "LECTURE SEULE"} — brouillons libres avec un lien de démo sans v= : ${todo.length}`);
  let written = 0;
  for (const row of todo) {
    const { data: variant } = await loose.from("message_variants").select("family").eq("message_id", row.id).maybeSingle();
    const family = ((variant as { family?: string } | null)?.family ?? null) as MailFamily | null;
    const fixed = ensureDemoV(row.body, family);
    // Garde : hors liens, le texte doit être identique.
    if (fixed.replace(/[?&]v=\d/g, "") !== row.body.replace(/[?&]v=\d/g, "")) {
      console.log(`  ${row.id.slice(0, 8)} ${row.type} : texte modifié hors lien — ignoré`);
      continue;
    }
    console.log(`  ${row.id.slice(0, 8)} ${row.type} (famille ${family ?? "?"}) : ${(row.body.match(UNMARKED) ?? []).join(" ")} → v=${family ? family.slice(1) : 0}`);
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
  if (apply) console.log(`\nCorrigés : ${written}.`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
