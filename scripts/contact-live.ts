/**
 * Test EN DIRECT du module contact sur un SIREN réel.
 *
 *   npm run contact:live -- 421882440            # BRIOL DIFFUSION, sans rien écrire
 *   npm run contact:live -- 520644386 --save     # ARTFLEX, écrit le résultat sur la fiche
 *
 * CONSOMME DES APPELS PAYANTS (Linkup, Hunter, et au plus un appel de modèle),
 * dans la limite du budget par fiche. Lit `.env.local` : à lancer en local, pas
 * depuis une session cloud (aucune clé n'y est disponible).
 *
 * Si le SIREN est déjà en portefeuille, la fiche sert de point de départ (site,
 * adresse, ville) ; sinon l'identité vient de l'annuaire public et de Pappers.
 * Aucune clé ni valeur secrète n'est affichée.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Prospect } from "../types";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const siren = args.find((arg) => /^\d{9}$/.test(arg.replace(/\s/g, "")))?.replace(/\s/g, "");
  const save = args.includes("--save");
  if (!siren) throw new Error("Usage : npm run contact:live -- <siren> [--save]");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis (.env.local)");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data } = await db.from("prospects").select("*").eq("siren", siren).limit(1).maybeSingle();
  const existing = data as Prospect | null;
  // Coûts imputés au propriétaire de la fiche (ou au compte indiqué), comme reenrich.ts.
  if (existing) process.env.ORION_SCRIPT_USER_ID ??= existing.user_id;

  // Import tardif : ces modules lisent l'environnement au premier appel.
  const { identityOf } = await import("../lib/contact-finder/sources");
  const { runContactSearch } = await import("../lib/contact-finder/finder");
  const { realDeps } = await import("../lib/contact-finder/clients");
  const { findContact } = await import("../lib/contact-finder");

  console.log(`\n=== ${existing?.company_name ?? "(hors portefeuille)"} — SIREN ${siren}`);
  const started = Date.now();

  if (existing && save) {
    const result = await findContact(existing.id, { db: db as never });
    console.log(JSON.stringify(result, null, 2));
    console.log(`\nÉcrit sur la fiche ${existing.id} en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    return;
  }

  const base = existing ?? ({ id: "live", company_name: siren, siren, website: null, email: null, city: null, key_figures: {} } as unknown as Prospect);
  const company = await identityOf(base);
  console.log("Identité :", JSON.stringify({ ...company, prospectId: undefined }, null, 2));
  const { result, trace } = await runContactSearch(company, realDeps(existing?.id ?? null));
  console.log("\nÉtapes :");
  for (const step of trace.steps) console.log(`  - ${step}`);
  console.log("\nDépenses :", JSON.stringify(trace.spent));
  console.log("\nRésultat :", JSON.stringify(result, null, 2));
  console.log(`\n${((Date.now() - started) / 1000).toFixed(1)} s — rien n'a été écrit${existing ? " (ajouter --save pour écrire)" : ""}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
