/**
 * IMPORT INITIAL DU CRM (Cowork #117). Plan dans lib/crm/import.ts.
 *
 *   npm run crm:import             # SIMULATION (défaut) : lit, affiche le plan, n'écrit rien
 *   npm run crm:import -- --apply  # crée les fiches (seulement une fois la migration crm_ appliquée)
 *
 * Lit `.env.local` (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE) sans jamais afficher de secret. Aucun appel
 * payant, aucun envoi, aucune modification ni suppression des prospects : on n'écrit que dans crm_offres (offres
 * initiales si la table est vide), crm_commerces et crm_evenements (une note « Fiche importée »).
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { lignesCommerces, planImport, STATUTS_INTERESSES, type ProspectSource } from "@/lib/crm/import";
import { OFFRES_INITIALES } from "@/lib/crm/types";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

type Loose = { from: (table: string) => any; auth: { admin: { listUsers: () => Promise<{ data: { users: { id: string }[] } }> } } };

async function main() {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const manquantes = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE"].filter((n) => !process.env[n]);
  if (manquantes.length) {
    console.error(`Variables manquantes : ${manquantes.join(", ")}. Script à lancer en local.`);
    process.exit(1);
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!, { auth: { persistSession: false } }) as unknown as Loose;

  const { data: comptes } = await db.auth.admin.listUsers();
  const userId = comptes.users[0]?.id;
  if (!userId) throw new Error("aucun utilisateur");

  const existants = await db.from("crm_commerces").select("nom, ville, prospect_id").eq("user_id", userId);
  if (existants.error) {
    console.error(`Table crm_commerces illisible (${existants.error.code ?? "?"}) : la migration crm_ n'est pas encore appliquée. Rien n'est fait.`);
    process.exit(apply ? 1 : 0);
  }
  const prospects = await db
    .from("prospects")
    .select("id, company_name, city, sector, siren, website, status, contact_name, contact_role, deleted_at")
    .eq("user_id", userId)
    .in("status", [...STATUTS_INTERESSES])
    .is("deleted_at", null);
  if (prospects.error) throw new Error(`lecture des prospects : ${prospects.error.message}`);

  const plan = planImport(existants.data ?? [], (prospects.data ?? []) as ProspectSource[]);
  console.log(`${apply ? "IMPORT" : "SIMULATION"} : ${plan.creer.length} fiche(s) à créer, ${plan.ignorees.length} déjà présente(s).`);
  for (const f of plan.creer) console.log(`  + ${f.nom}${f.ville ? ` (${f.ville})` : ""} · ${f.etape} · ${f.origine}`);
  for (const f of plan.ignorees) console.log(`  = ${f.nom} : ${f.raison}`);
  if (!apply) {
    console.log("Rien n'a été écrit. Relancer avec --apply pour créer ces fiches.");
    return;
  }

  // Offres : on sème la liste initiale si elle est vide, puis Optique des Alpes reçoit « Essentiel ».
  let offres = await db.from("crm_offres").select("id, libelle").eq("user_id", userId);
  if (!offres.error && !(offres.data ?? []).length) {
    await db.from("crm_offres").insert(OFFRES_INITIALES.map((o, i) => ({ ...o, ordre: i, user_id: userId })));
    offres = await db.from("crm_offres").select("id, libelle").eq("user_id", userId);
  }
  const essentiel = ((offres.data ?? []) as { id: string; libelle: string }[]).find((o) => o.libelle === "Essentiel");

  let crees = 0;
  for (const [i, ligne] of lignesCommerces(plan.creer, userId).entries()) {
    const valeurs = plan.creer[i].nom === "Optique des Alpes" && essentiel ? { ...ligne, offre_id: essentiel.id } : ligne;
    const r = await db.from("crm_commerces").insert(valeurs).select("id").single();
    if (r.error) {
      console.error(`  ! ${plan.creer[i].nom} : ${r.error.message}`);
      continue;
    }
    await db.from("crm_evenements").insert({ user_id: userId, commerce_id: r.data.id, type: "note", contenu: `Fiche importée (${plan.creer[i].origine}).` });
    crees += 1;
  }
  console.log(`${crees} fiche(s) créée(s).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
