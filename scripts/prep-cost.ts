/**
 * COÛT D'UNE PRÉPARATION (lecture seule, Cowork #44) — pour un ou plusieurs
 * jobs `prepare` : relances rédigées pendant le job, coût OpenAI par opération
 * sur la fenêtre du job, fiches prêtes du run, coût de préparation par fiche prête.
 *
 *   npm run prep:cout -- --job <id> [--job <id> …]
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";

const jobs = process.argv.flatMap((arg, index) => (arg === "--job" ? [process.argv[index + 1]] : [])).filter(Boolean) as string[];

import { WRITING_OPERATIONS as WRITING } from "@/lib/usage/prep-cost";

function stepOf(operation: string): string {
  if (operation === "relance") return "relances";
  if (operation === "facts") return "faits";
  if (/profil|profile/.test(operation)) return "profil métier";
  if (/tri|triage|entonnoir/.test(operation)) return "tri";
  if (/brief|contact|civilite|pick-domain|site/.test(operation)) return "creusage / contact";
  return operation;
}

async function main() {
  const userId = await ownerId();
  if (!jobs.length) throw new Error("--job <id> obligatoire");
  for (const id of jobs) {
    const { data: job } = await db.from("jobs").select("id, created_at, updated_at, state, params").eq("id", id).maybeSingle();
    if (!job) {
      console.log(`job ${id} introuvable`);
      continue;
    }
    const row = job as { id: string; created_at: string; updated_at: string; state: { runId?: string } | null };
    const from = row.created_at;
    const to = row.updated_at;
    console.log(`\n=== job ${row.id} — ${from} → ${to}`);

    // 1. Relances créées pendant le job : état, et rien de parti ni de programmé.
    const relances = await readAll<{ id: string; prospect_id: string; type: string; status: string; send_status: string | null; validated_at: string | null; scheduled_at: string | null; edited_by_hand: boolean | null; created_at: string }>(() =>
      db.from("messages").select("id, prospect_id, type, status, send_status, validated_at, scheduled_at, edited_by_hand, created_at").eq("user_id", userId).in("type", ["relance_1", "relance_2"]).gte("created_at", from).lte("created_at", to).order("id"),
    );
    const names = new Map<string, string>();
    if (relances.length) {
      const { data } = await db.from("prospects").select("id, company_name").in("id", [...new Set(relances.map((item) => item.prospect_id))]);
      for (const prospect of (data ?? []) as { id: string; company_name: string }[]) names.set(prospect.id, prospect.company_name);
    }
    const sent = relances.filter((item) => item.status === "sent").length;
    const scheduled = relances.filter((item) => item.send_status === "scheduled" || item.send_status === "sending" || item.scheduled_at).length;
    const validated = relances.filter((item) => item.validated_at).length;
    console.log(`Relances rédigées pendant le job : ${relances.length} — parties : ${sent}, programmées : ${scheduled}, validées : ${validated}`);
    for (const item of relances) console.log(`  · ${names.get(item.prospect_id) ?? item.prospect_id} · ${item.type} · ${item.status}/${item.send_status ?? "draft"}${item.edited_by_hand ? " · retouchée" : ""}`);

    // 2. Coût OpenAI de la fenêtre, par étape (rédaction exclue).
    const usage = await readAll<{ operation: string | null; cost: number | null }>(() =>
      db.from("api_usage").select("operation, cost").eq("service", "openai").gte("created_at", from).lte("created_at", to).order("id"),
    );
    const bySteps = new Map<string, number>();
    let writing = 0;
    for (const item of usage) {
      const operation = item.operation ?? "?";
      const cost = Number(item.cost) || 0;
      if (WRITING.test(operation)) {
        writing += cost;
        continue;
      }
      bySteps.set(stepOf(operation), (bySteps.get(stepOf(operation)) ?? 0) + cost);
    }
    const prep = [...bySteps.values()].reduce((a, b) => a + b, 0);
    console.log(`OpenAI préparation : ${prep.toFixed(3)} € — ${[...bySteps].sort((a, b) => b[1] - a[1]).map(([step, eur]) => `${step} ${eur.toFixed(3)}`).join(" · ")}`);
    console.log(`(rédaction pendant la même fenêtre, exclue : ${writing.toFixed(3)} €)`);

    // 3. Fiches prêtes du run.
    const runId = row.state?.runId;
    const ready = runId
      ? ((await readAll<{ id: string }>(() => db.from("signal_candidates").select("id").eq("user_id", userId).eq("run_id", runId).eq("statut", "creusé").eq("publication", "pret").order("id"))).length)
      : 0;
    const dug = runId
      ? ((await readAll<{ id: string }>(() => db.from("signal_candidates").select("id").eq("user_id", userId).eq("run_id", runId).eq("statut", "creusé").order("id"))).length)
      : 0;
    console.log(`Fiches creusées : ${dug}, prêtes (email) : ${ready} → préparation ${ready ? (prep / ready).toFixed(3) : "—"} € par fiche prête`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
