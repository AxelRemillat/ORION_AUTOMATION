/**
 * EXPÉRIENCES SUR LES MAILS (Cowork #30) — créer, activer, arrêter.
 *
 * Rien n'est activé tant qu'Axel ne l'a pas décidé. Agent LOCAL : lit
 * `.env.local` (clé service), n'affiche aucun secret.
 *
 *   npx tsx scripts/experience-mails.ts liste
 *   npx tsx scripts/experience-mails.ts creer "Appel à l'action" \
 *       "rdv=Auriez-vous 15 minutes la semaine prochaine pour en parler ?" \
 *       "video=Voulez-vous que je vous envoie une vidéo de 2 minutes ?"
 *   npx tsx scripts/experience-mails.ts activer <id>     # une seule active ; date de début posée au premier démarrage
 *   npx tsx scripts/experience-mails.ts arreter <id>
 *
 * Créée = INACTIVE. Active = chaque NOUVEAU brouillon d'intro reçoit une
 * variante tirée au hasard, équilibrée. Arrêtée = plus aucun tirage ; les
 * brouillons déjà rédigés gardent leur variante, l'encart du Cockpit reste.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseVariants } from "../lib/experiments/model";

for (const line of existsSync(".env.local") ? readFileSync(".env.local", "utf8").split(/\r?\n/) : []) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis (script local).");
const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as { from: (table: string) => any; auth: { admin: { listUsers: (o: object) => Promise<{ data: { users: { id: string }[] } }> } } };

async function owner(): Promise<string> {
  const configured = process.env.OPPORTUNITIES_USER_ID?.trim();
  if (configured) return configured;
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 2 });
  if (data.users.length !== 1) throw new Error("Propriétaire ambigu : renseignez OPPORTUNITIES_USER_ID.");
  return data.users[0].id;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const userId = await owner();
  if (command === "liste" || !command) {
    const { data, error } = await db.from("mail_experiments").select("id, name, active, started_at, variants").eq("user_id", userId).order("created_at");
    if (error) throw new Error(error.message);
    if (!data?.length) console.log("Aucune expérience.");
    for (const row of data ?? []) console.log(`${row.id}  ${row.active ? "ACTIVE  " : "inactive"}  ${row.name}  ${JSON.stringify(row.variants)}`);
    return;
  }
  if (command === "creer") {
    const [name, ...specs] = args;
    const variants = parseVariants(specs.map((spec) => ({ key: spec.slice(0, spec.indexOf("=")), cta: spec.slice(spec.indexOf("=") + 1) })));
    if (!name || !variants) throw new Error("Usage : creer <nom> <clé=phrase ?> <clé=phrase ?> … (au moins deux, clés distinctes, phrases finissant par « ? »)");
    const { data, error } = await db.from("mail_experiments").insert({ user_id: userId, name, variants, active: false }).select("id").single();
    if (error) throw new Error(error.message);
    console.log(`Créée, INACTIVE : ${data.id}`);
    return;
  }
  if (command === "activer" || command === "arreter") {
    const id = args[0];
    if (!id) throw new Error(`Usage : ${command} <id>`);
    if (command === "activer") {
      const { data: active } = await db.from("mail_experiments").select("id").eq("user_id", userId).eq("active", true);
      if ((active ?? []).some((row: { id: string }) => row.id !== id)) throw new Error("Une autre expérience est active : arrêtez-la d'abord.");
      const { data: row } = await db.from("mail_experiments").select("started_at").eq("id", id).eq("user_id", userId).maybeSingle();
      if (!row) throw new Error("Expérience introuvable.");
      const { error } = await db.from("mail_experiments").update({ active: true, ...(row.started_at ? {} : { started_at: new Date().toISOString() }) }).eq("id", id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("mail_experiments").update({ active: false }).eq("id", id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    }
    console.log(command === "activer" ? "Active : chaque nouveau brouillon d'intro reçoit une variante." : "Arrêtée : plus aucun tirage, les variantes posées restent.");
    return;
  }
  throw new Error("Commandes : liste | creer | activer | arreter");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
