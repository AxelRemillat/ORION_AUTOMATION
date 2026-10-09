/**
 * RETRAIT DES BOÎTES DE RÔLE JURIDIQUE des fiches (Cowork #41) — en local.
 * AUCUNE suppression : l'adresse part dans `key_figures.email_removed` (motif,
 * date), la fiche repasse « Contact à vérifier » (`key_figures.contact_review`)
 * et sort des prêts. Jamais une fiche déjà contactée, jamais un brouillon
 * validé, programmé ou retouché à la main (rien n'est écrit sur les brouillons).
 *
 *   npm run contacts:roles            → simulation (liste)
 *   npm run contacts:roles -- --apply → réel
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { isRoleBox, ROLE_BOX_REASON } from "@/lib/contact-finder/role-boxes";

const APPLY = process.argv.includes("--apply");

async function main() {
  const userId = await ownerId();
  const now = new Date().toISOString();
  const prospects = await readAll<{ id: string; company_name: string; email: string | null; key_figures: Record<string, unknown> | null }>(() =>
    db.from("prospects").select("id, company_name, email, key_figures").eq("user_id", userId).is("deleted_at", null).not("email", "is", null).order("id"),
  );
  const targets = prospects.filter((row) => isRoleBox(row.email));
  console.log(`Fiches avec une boîte de rôle juridique : ${targets.length}`);
  for (const row of targets) {
    const { data: sent } = await db.from("messages").select("id").eq("prospect_id", row.id).eq("status", "sent").limit(1);
    if (sent?.length) {
      console.log(`  · ${row.company_name} <${row.email}> — déjà contactée : laissée telle quelle`);
      continue;
    }
    console.log(`  · ${row.company_name} <${row.email}>${APPLY ? " → retirée, « Contact à vérifier »" : ""}`);
    if (!APPLY) continue;
    const figures = row.key_figures ?? {};
    await db
      .from("prospects")
      .update({
        email: null,
        email_type: null,
        key_figures: { ...figures, email_removed: { email: row.email, reason: ROLE_BOX_REASON, at: now }, contact_review: { reason: `adresse ${row.email} retirée : ${ROLE_BOX_REASON}`, at: now } },
      } as never)
      .eq("id", row.id)
      .eq("user_id", userId);
    // La carte d'entonnoir garde aussi l'adresse : elle sort des prêts.
    const { data: cards } = await db.from("signal_candidates").select("id, contact, publication").eq("prospect_id", row.id);
    for (const card of (cards ?? []) as { id: string; contact: Record<string, unknown> | null; publication: string | null }[]) {
      const contact = card.contact ?? {};
      if (!isRoleBox(contact.email as string | null)) continue;
      await db
        .from("signal_candidates")
        .update({ publication: "a_completer", contact: { ...contact, email: null, email_type: null, badge: "aucun", email_removed: { email: contact.email, reason: ROLE_BOX_REASON, at: now } } } as never)
        .eq("id", card.id);
    }
  }
  if (!APPLY) console.log("SIMULATION : relancer avec --apply.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
