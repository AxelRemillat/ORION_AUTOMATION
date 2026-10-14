/**
 * RÉDACTION DE LA FILE « À COMPLÉTER » (Cowork #35) — SIMULATION par défaut.
 *
 * Fiches « Brouillon manquant » ou « À revoir » qui ont une adresse : UNE génération chacune
 * (job `email_generate`, comme la préparation), juge à jour. Le plafond des régénérations
 * automatiques (1 par fiche / 7 j hors création, lib/jobs/regen-cap.ts) est appliqué ICI, car un
 * job d'agent (`USAGE_SOURCE=agent4`, coût tracé) n'y est pas soumis. Jamais un brouillon retouché
 * à la main, validé ou programmé (le job ne les réécrit pas ; ils sont aussi écartés d'avance).
 * « Faits insuffisants » : laissé avec son motif (le profil est déjà lu, une régénération
 * retomberait sur la même porte).
 *
 *   USAGE_SOURCE=agent4 … rediger-file.js                 liste, rien n'est lancé
 *   USAGE_SOURCE=agent4 … rediger-file.js --lancer [--max 30]
 */
import { db, ownerId } from "./quality-live";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import { createJob } from "@/lib/jobs/store";
import { autoRegenRefusal, scriptJobSource } from "@/lib/jobs/regen-cap";

const launch = process.argv.includes("--lancer");
const maxArg = process.argv.indexOf("--max");
const MAX = maxArg >= 0 ? Math.max(1, Number(process.argv[maxArg + 1]) || 30) : 30;
const BLOCKERS = ["Email manquant", "Email non vérifié", "Site introuvable", "Faits insuffisants", "Filiale de groupe"];

async function main() {
  const userId = await ownerId();
  const table = db as never as { from: (t: string) => any };
  const items = flatten((await loadToday(db as never, userId)).groups).filter(
    (item) => item.kind === "a_completer" && item.prospectId && item.contact.email && (item.tags.includes("Brouillon manquant") || item.tags.includes("À revoir")),
  );
  let launched = 0;
  console.log(`${items.length} fiche(s) « Brouillon manquant » ou « À revoir » avec adresse${launch ? "" : " — SIMULATION"}`);
  for (const item of items) {
    const blocker = BLOCKERS.find((tag) => item.tags.includes(tag as never));
    if (blocker) {
      console.log(`· ${item.companyName} | laissée : ${blocker}`);
      continue;
    }
    if (item.messageId) {
      const { data: draft } = await table.from("messages").select("status, edited_by_hand, validated_at, send_status").eq("id", item.messageId).maybeSingle();
      if (draft && (draft.edited_by_hand || draft.validated_at || draft.status !== "draft" || ["scheduled", "sending"].includes(draft.send_status))) {
        console.log(`· ${item.companyName} | laissée : brouillon retouché, validé ou programmé`);
        continue;
      }
    }
    const { data: jobs } = await table.from("jobs").select("id, created_at, params, result").eq("user_id", userId).eq("type", "email_generate").eq("status", "done").contains("params", { prospectId: item.prospectId }).order("created_at", { ascending: true }).limit(200);
    const history = ((jobs ?? []) as { created_at: string; params: { auto?: boolean } | null; result: { messageId?: string } | null }[])
      .filter((row) => Boolean(row.result?.messageId))
      .map((row) => ({ createdAt: row.created_at, auto: row.params?.auto === true }));
    // Toute génération d'agent compte ici comme automatique : le plafond vaut pour nous aussi.
    const refusal = autoRegenRefusal(history.map((entry, index) => ({ ...entry, auto: index > 0 ? true : entry.auto })));
    if (refusal) {
      console.log(`· ${item.companyName} | laissée : ${refusal}`);
      continue;
    }
    if (!launch || launched >= MAX) {
      console.log(`· ${item.companyName} | ${launch ? "plafond du lot atteint" : "génération prévue"}`);
      continue;
    }
    const created = await createJob(
      db as never,
      { type: "email_generate", target: { prospectId: item.prospectId!, label: `Mail ${item.companyName}` }, params: { prospectId: item.prospectId!, mode: "full", saveDraft: true, storedContact: true, auto: true, ...scriptJobSource() } },
      userId,
    );
    launched += "id" in created ? 1 : 0;
    console.log(`· ${item.companyName} | ${"id" in created ? `job lancé ${created.id}` : `non lancé (${created.error})`}`);
  }
  console.log(`\n${launched} génération(s) lancée(s).`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
