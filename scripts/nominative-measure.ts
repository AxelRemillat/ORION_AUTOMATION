/**
 * MESURE du taux d'adresses nominatives (Cowork #32, 06/10/2026) — lecture
 * seule, en local contre la base (.env.local), 0 crédit.
 *
 *   npm run contacts:mesure                         → les 20 dernières fiches complétées
 *   npm run contacts:mesure -- --last 20 --since 2026-10-06T17:00:00Z   → après une date (ex. le merge)
 *   npm run contacts:mesure -- --last 20 --before 2026-10-06T17:00:00Z  → avant
 *
 * « Complétée » = une recherche de contact a tourné (`contact_checked_at`).
 * Donne : taux nominatif, crédits Hunter par fiche (api_usage), et la liste
 * des fiches restées génériques ou sans adresse, avec ce qui a été tenté.
 */
import { db, ownerId } from "./quality-live";
import { isGenericAddress } from "@/lib/contact-finder/upgrade";

const value = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const LAST = Math.max(1, Number(value("--last")) || 20);
const SINCE = value("--since");
const BEFORE = value("--before");

type Row = {
  id: string;
  company_name: string;
  email: string | null;
  email_type: string | null;
  contact_checked_at: string | null;
  contact_name?: string | null;
  contact_role?: string | null;
  key_figures: Record<string, unknown> | null;
};

async function main() {
  const userId = await ownerId();
  let query = db
    .from("prospects")
    .select("id, company_name, email, email_type, contact_checked_at, contact_name, contact_role, key_figures")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("contact_checked_at", "is", null)
    .order("contact_checked_at", { ascending: false })
    .limit(LAST);
  if (SINCE) query = query.gte("contact_checked_at", SINCE);
  if (BEFORE) query = query.lt("contact_checked_at", BEFORE);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) {
    console.log("Aucune fiche complétée sur la période.");
    return;
  }

  const nominative = rows.filter((row) => row.email && !isGenericAddress(row));
  const { data: usage } = await db.from("api_usage").select("units, prospect_id").eq("service", "hunter").in("prospect_id", rows.map((row) => row.id));
  const credits = ((usage ?? []) as { units: number }[]).reduce((total, row) => total + (Number(row.units) || 0), 0);

  const period = SINCE ? ` depuis ${SINCE}` : BEFORE ? ` avant ${BEFORE}` : "";
  console.log(`${rows.length} dernière(s) fiche(s) complétée(s)${period}`);
  console.log(`Taux nominatif : ${Math.round((nominative.length / rows.length) * 100)} % (${nominative.length}/${rows.length})`);
  console.log(`Crédits Hunter : ${credits} au total, ${(credits / rows.length).toFixed(1)} par fiche`);
  // Faits distinctifs (Cowork #34) et coût OpenAI imputé à ces fiches.
  const scores = rows.map((row) => (Array.isArray(row.key_figures?.facts) ? Number(row.key_figures?.facts_score ?? 0) : null));
  const distribution = [0, 1, 2, 3].map((score) => `${score} : ${scores.filter((value) => value === score).length}`).join(" · ");
  console.log(`facts_score : ${distribution} · sans extraction : ${scores.filter((value) => value === null).length}`);
  const { data: openai } = await db.from("api_usage").select("cost, prospect_id").eq("service", "openai").in("prospect_id", rows.map((row) => row.id));
  const eur = ((openai ?? []) as { cost: number | null }[]).reduce((total, row) => total + (Number(row.cost) || 0), 0);
  console.log(`Coût OpenAI imputé : ${eur.toFixed(3)} € (${(eur / rows.length).toFixed(3)} € par fiche)`);
  console.log("\nSans adresse nominative :");
  for (const row of rows.filter((item) => !nominative.includes(item))) {
    const trace = (row.key_figures?.nominative ?? null) as { steps?: string[]; version?: number } | null;
    const hint = (row.key_figures?.addressee_hint ?? null) as { text?: string } | null;
    const why = !row.email ? "aucune adresse" : trace?.steps?.at(-1) ?? "pas de recherche nominative";
    console.log(`  · ${row.company_name} <${row.email ?? "—"}> — ${why}${hint?.text ? ` · ${hint.text}` : ""}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
