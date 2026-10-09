/**
 * RECLASSEMENT des adresses déjà en base avec les règles ACTUELLES de
 * classifyEmail (Cowork #43 : « initiale.nom@ », LORMEDO `e.lahmadi@`).
 * Seul `email_type` change, de « generique » à « nominatif » ; rien d'autre.
 *
 *   npm run contacts:reclasse            → simulation (liste)
 *   npm run contacts:reclasse -- --apply → réel
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { classifyEmail } from "@/lib/contact-finder/extract";
import { isRoleBox } from "@/lib/contact-finder/role-boxes";

const APPLY = process.argv.includes("--apply");

async function main() {
  const userId = await ownerId();
  const rows = await readAll<{ id: string; company_name: string; email: string | null; email_type: string | null }>(() =>
    db.from("prospects").select("id, company_name, email, email_type").eq("user_id", userId).is("deleted_at", null).eq("email_type", "generique").order("id"),
  );
  const changed = rows.filter((row) => row.email && !isRoleBox(row.email) && classifyEmail(row.email) === "nominatif");
  console.log(`Adresses classées « générique » que la règle actuelle reconnaît nominatives : ${changed.length}`);
  for (const row of changed) {
    console.log(`  · ${row.company_name} <${row.email}>`);
    if (APPLY) await db.from("prospects").update({ email_type: "nominatif" } as never).eq("id", row.id).eq("user_id", userId).eq("email_type", "generique");
  }
  console.log(APPLY ? "Reclassées." : "SIMULATION : relancer avec --apply.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
