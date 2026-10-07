/**
 * COMPLÉTION DES CONTACTS D'UN LOT (Cowork #37) — en local, contre la base.
 * Aucun envoi, aucune suppression ; tout appel Hunter sous un PLAFOND DE LOT.
 *
 *   npm run contacts:lot -- --since <ISO> --hunter-cap 30            → simulation (liste, 0 crédit)
 *   npm run contacts:lot -- --since <ISO> --hunter-cap 30 --apply    → réel
 *
 *   1. adresses GÉNÉRIQUES du lot : recherche nominative (lib/contact-finder/upgrade.ts) ;
 *   2. fiches SANS adresse : module contact (site, pages, Hunter ; pas de Linkup),
 *      puis recherche nominative si l'adresse trouvée est générique ;
 *      cause de l'échec, fiche par fiche : pas de site / site sans contact /
 *      domaine inconnu de Hunter / autre.
 */
import { db, ownerId } from "./quality-live";
import { findContact } from "@/lib/contact-finder";
import { upgradeProspectLive } from "@/lib/contact-finder/nominative-live";
import { isGenericAddress } from "@/lib/contact-finder/upgrade";
import { withHunterRunCap } from "@/lib/hunter/run-cap";
import type { Db } from "@/lib/trash/scope";

const value = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const SINCE = value("--since");
const CAP = Math.max(0, Number(value("--hunter-cap")) || 30);
const APPLY = process.argv.includes("--apply");

type Row = { id: string; company_name: string; email: string | null; email_type: string | null; website: string | null; key_figures: Record<string, unknown> | null };
type Trace = {
  candidates?: { validated?: boolean }[];
  hunter?: { call: string; result: string }[];
  steps?: string[];
  result?: { website?: string; email?: string; hunter_skipped?: string };
};

/** Pourquoi la fiche reste sans adresse, d'après le journal de la recherche. */
export function causeOf(prospect: { website: string | null }, trace: Trace | null): string {
  const site = prospect.website || trace?.result?.website || trace?.candidates?.some((item) => item.validated);
  if (!site) return "pas de site";
  const skipped = trace?.result?.hunter_skipped;
  const search = trace?.hunter?.find((call) => call.call === "domain-search");
  const unknown = search && /^0 adresse/.test(search.result);
  const causes = ["site sans contact"];
  if (unknown) causes.push("domaine inconnu de Hunter");
  else if (skipped) causes.push(`Hunter non appelé (${skipped})`);
  else if (!search) causes.push("Hunter non interrogé");
  return causes.join(" + ");
}

async function hunterSince(since: string): Promise<number> {
  const { data } = await db.from("api_usage").select("units").eq("service", "hunter").gte("created_at", since);
  return ((data ?? []) as { units: number }[]).reduce((total, row) => total + (Number(row.units) || 0), 0);
}

async function main() {
  if (!SINCE) throw new Error("--since <ISO> obligatoire (début du lot)");
  const userId = await ownerId();
  const started = new Date();
  const { data } = await db
    .from("prospects")
    .select("id, company_name, email, email_type, website, key_figures")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("contact_checked_at", SINCE)
    .order("contact_checked_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as Row[];
  const generic = rows.filter((row) => row.email && isGenericAddress(row));
  const empty = rows.filter((row) => !row.email);
  console.log(`Lot : ${rows.length} fiche(s) — ${generic.length} générique(s), ${empty.length} sans adresse ; plafond Hunter ${CAP} crédits`);
  if (!APPLY) {
    for (const row of generic) console.log(`  générique · ${row.company_name} <${row.email}>`);
    for (const row of empty) console.log(`  sans adresse · ${row.company_name} (${row.website ?? "pas de site connu"})`);
    console.log("SIMULATION : relancer avec --apply.");
    return;
  }

  await withHunterRunCap(CAP, started, async () => {
    console.log("\n1. Adresses génériques → recherche nominative");
    for (const row of generic) {
      const result = await upgradeProspectLive(db as unknown as Db, row.id);
      console.log(`  ${row.company_name} | ${result.status} | ${result.contact ? `${result.contact.name ?? "?"} — ${result.contact.role} <${result.contact.email}> (${result.contact.source}, ${result.contact.verifier})` : result.reason}`);
    }
    console.log("\n2. Fiches sans adresse → module contact (sans Linkup)");
    for (const row of empty) {
      const found = await findContact(row.id, { db: db as never, userId, linkup: 0 }).catch((error) => {
        console.log(`  ${row.company_name} | erreur : ${error instanceof Error ? error.message : error}`);
        return null;
      });
      if (found?.email && found.email_type === "generique") await upgradeProspectLive(db as unknown as Db, row.id).catch(() => null);
      const { data: fresh } = await db.from("prospects").select("email, email_type, website, contact_search").eq("id", row.id).maybeSingle();
      const after = fresh as { email: string | null; email_type: string | null; website: string | null; contact_search: Trace | null } | null;
      const outcome = after?.email ? `trouvée : ${after.email} (${after.email_type ?? "?"})` : `aucune — ${causeOf({ website: after?.website ?? row.website }, after?.contact_search ?? null)}`;
      console.log(`  ${row.company_name} | ${outcome}`);
    }
  });
  console.log(`\nCrédits Hunter consommés par ce run : ${await hunterSince(started.toISOString())} (plafond ${CAP})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
