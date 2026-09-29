/**
 * Marque les fiches EXISTANTES dont l'entreprise s'oppose à l'usage commercial
 * de ses données.
 *
 *   npx tsx scripts/backfill-opposition.ts           # liste, n'écrit rien
 *   npx tsx scripts/backfill-opposition.ts --write   # écrit key_figures.refuses_prospecting
 *
 * Le drapeau est posé à l'enrichissement pour les fiches NOUVELLES ; les fiches
 * ouvertes avant ne le portent pas, et leur badge ne s'afficherait jamais. Un
 * crédit Pappers par fiche.
 *
 * Aucune donnée n'est supprimée, aucun statut n'est changé : seul
 * `key_figures.refuses_prospecting` est écrit.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Prospect } from "../types";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis");
  const db = createClient(url, key, { auth: { persistSession: false } });
  /*
   * APPEL DIRECT, volontairement.
   *
   * Le client Pappers n'expose `refuses_prospecting` que sur la branche de
   * l'entonnoir. Ce script de maintenance doit tourner sur n'importe quelle
   * branche : il lit donc le champ brut lui-même. Premier essai avec le
   * client : « 0 opposé sur 8 », parce que le champ n'existait pas encore —
   * silencieusement `undefined`.
   */
  const token = process.env.PAPPERS_API_KEY;
  if (!token) throw new Error("PAPPERS_API_KEY requise");
  const opposition = async (siren: string): Promise<boolean | null> => {
    const response = await fetch(`https://api.pappers.fr/v2/entreprise?api_token=${token}&siren=${siren}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { opposition_utilisation_commerciale?: boolean };
    return body.opposition_utilisation_commerciale === true;
  };

  const { data } = await db.from("prospects").select("*").is("deleted_at", null).not("siren", "is", null);
  const prospects = (data ?? []) as Prospect[];
  let opposed = 0;

  for (const prospect of prospects) {
    const refuses = await opposition(prospect.siren as string);
    if (refuses === null) {
      console.log(`  ?  ${prospect.company_name} — Pappers injoignable`);
      continue;
    }
    if (refuses) opposed += 1;
    console.log(`  ${refuses ? "OPPOSÉ" : "ok    "} ${prospect.company_name} (${prospect.siren})`);

    if (write && refuses && prospect.key_figures?.refuses_prospecting !== true) {
      await db
        .from("prospects")
        .update({ key_figures: { ...prospect.key_figures, refuses_prospecting: true } })
        .eq("id", prospect.id);
    }
  }

  console.log(`\n${opposed} opposé(s) sur ${prospects.length} fiche(s)${write ? " — drapeau écrit." : " — rien écrit (ajouter --write)."}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
