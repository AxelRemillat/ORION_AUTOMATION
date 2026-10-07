/**
 * RATTRAPAGE des faits distinctifs + du marqueur « à régénérer » (Cowork #34)
 * — en local, contre la base (.env.local). Aucun envoi, aucune suppression,
 * aucun brouillon réécrit.
 *
 *   npm run facts:rattrapage                     → simulation (lecture seule)
 *   npm run facts:rattrapage -- --apply          → réel (OpenAI léger, plafond --max-eur, défaut 0,60 €)
 *   npm run facts:rattrapage -- --apply --limit 30 --max-eur 1
 *
 * Faits : fiches NON contactées, avec un site, ni opposées ni « ne plus
 * contacter », dont aucun brouillon n'est validé, programmé ou retouché à la
 * main, et sans faits encore.
 *
 * Marqueur : `messages.regenerate_reason` (texte non nul = à régénérer) posé
 * sur les brouillons d'intro LIBRES écrits AVANT un changement de destinataire
 * (contact nominatif trouvé après coup). Rien n'est régénéré ici.
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { isFreeDraft } from "@/lib/contact-finder/upgrade";
import { ensureFacts } from "@/lib/enrichment/facts-server";
import type { SourcedFact } from "@/lib/enrichment/facts";
import type { Db } from "@/lib/trash/scope";

const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const APPLY = process.argv.includes("--apply");
const LIMIT = arg("--limit", 40);
const MAX_EUR = arg("--max-eur", 0.6);

type Prospect = {
  id: string;
  company_name: string;
  website: string | null;
  sector: string | null;
  email: string | null;
  do_not_contact: boolean | null;
  contact_source: string | null;
  contact_name: string | null;
  key_figures: Record<string, unknown> | null;
};
type MessageRow = Parameters<typeof isFreeDraft>[0] & { prospect_id: string; created_at: string; regenerate_reason: string | null };

async function openAiSince(since: string): Promise<number> {
  const rows = await readAll<{ cost: number | null }>(() => db.from("api_usage").select("cost").eq("service", "openai").gte("created_at", since).order("id"));
  return rows.reduce((total, row) => total + (Number(row.cost) || 0), 0);
}

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const prospects = await readAll<Prospect>(() =>
    db.from("prospects").select("id, company_name, website, sector, email, do_not_contact, contact_source, contact_name, key_figures").eq("user_id", userId).is("deleted_at", null).order("id"),
  );
  const messages = await readAll<MessageRow>(() =>
    db.from("messages").select("id, prospect_id, type, status, send_status, validated_at, edited_by_hand, scheduled_at, deleted_at, created_at, regenerate_reason").eq("user_id", userId).order("id"),
  );
  const byProspect = new Map<string, MessageRow[]>();
  for (const row of messages) if (!row.deleted_at && row.type !== "note") byProspect.set(row.prospect_id, [...(byProspect.get(row.prospect_id) ?? []), row]);

  // --- 1. Marqueur « à régénérer » : destinataire changé après la rédaction ---
  const toFlag: { row: MessageRow; prospect: Prospect }[] = [];
  for (const prospect of prospects) {
    const trace = prospect.key_figures?.nominative as { found?: string | null; checked_at?: string } | undefined;
    if (!trace?.found || !trace.checked_at || !prospect.contact_source?.startsWith("hunter")) continue;
    for (const row of byProspect.get(prospect.id) ?? []) {
      if (row.type === "intro" && isFreeDraft(row) && !row.regenerate_reason && row.created_at < trace.checked_at) toFlag.push({ row, prospect });
    }
  }
  console.log(`Marqueur messages.regenerate_reason — brouillons libres écrits avant le nouveau destinataire : ${toFlag.length}`);
  for (const { row, prospect } of toFlag) {
    console.log(`  · ${prospect.company_name} → ${prospect.contact_name ?? prospect.email} (brouillon ${row.id})`);
    if (APPLY) {
      await db
        .from("messages")
        .update({ regenerate_reason: `Destinataire changé : ${prospect.contact_name ?? ""} <${prospect.email}>.`, regenerate_requested_at: started } as never)
        .eq("id", row.id)
        .eq("status", "draft")
        .is("validated_at", null)
        .eq("edited_by_hand", false);
    }
  }
  const flagged = messages.filter((row) => row.regenerate_reason && !row.deleted_at && row.status === "draft");
  console.log(`Déjà marqués : ${flagged.length}${flagged.length ? ` (${flagged.map((row) => prospects.find((item) => item.id === row.prospect_id)?.company_name ?? row.prospect_id).join(", ")})` : ""}`);

  // --- 2. Faits distinctifs ---------------------------------------------------
  const eligible = prospects.filter((prospect) => {
    const rows = byProspect.get(prospect.id) ?? [];
    const figures = prospect.key_figures ?? {};
    return (
      prospect.website &&
      !prospect.do_not_contact &&
      figures.refuses_prospecting !== true &&
      !rows.some((row) => row.status === "sent") &&
      rows.every(isFreeDraft) &&
      !Array.isArray(figures.facts)
    );
  });
  console.log(`\nFaits distinctifs — fiches éligibles (non contactées, site, brouillon libre, sans faits) : ${eligible.length}`);
  if (!APPLY) {
    console.log(`SIMULATION : ~${Math.min(eligible.length, LIMIT)} appel(s) de modèle léger, plafond ${MAX_EUR} €. Relancer avec --apply.`);
    return;
  }

  const results: { company: string; score: number; facts: SourcedFact[] }[] = [];
  for (const prospect of eligible.slice(0, LIMIT)) {
    if ((await openAiSince(started)) >= MAX_EUR) {
      console.log(`arrêt : plafond OpenAI du run atteint (${MAX_EUR} €)`);
      break;
    }
    const run = await ensureFacts(db as unknown as Db, prospect).catch((error) => {
      console.log(`${prospect.company_name} | erreur : ${error instanceof Error ? error.message : error}`);
      return null;
    });
    if (!run) continue;
    results.push({ company: prospect.company_name, score: run.score, facts: run.facts });
    console.log(`${prospect.company_name} | score ${run.score} | ${run.facts.length} fait(s)${run.note ? ` | ${run.note}` : ""}`);
  }

  const distribution = [0, 1, 2, 3].map((score) => `${score} : ${results.filter((item) => item.score === score).length}`).join(" · ");
  console.log("\n=== RAPPORT ===");
  console.log(`Fiches traitées : ${results.length} — facts_score ${distribution}`);
  console.log(`Coût OpenAI du run : ${(await openAiSince(started)).toFixed(4)} €`);
  for (const score of [3, 2, 0]) {
    const example = results.find((item) => item.score === score);
    if (!example) continue;
    console.log(`\nExemple score ${score} — ${example.company}`);
    for (const fact of example.facts) console.log(`  [${fact.distinctiveness}] « ${fact.text} » (${fact.page_kind}${fact.process_hint ? ` → ${fact.process_hint}` : ""})`);
    if (!example.facts.length) console.log("  (aucun fait sûr)");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
