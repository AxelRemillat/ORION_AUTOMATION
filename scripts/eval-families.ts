/**
 * ÉVALUATION DES FAMILLES F2 à F4 sur des fiches réelles (PAYANT, plafond 0,20 €).
 *
 *   npm run eval:families -- 4      4 fiches de la file × F2, F3, F4
 *
 * Rien n'est écrit en base (aucun brouillon, aucun envoi) : les mails sont
 * affichés avec leur note pour relecture.
 */
import { db, ownerId, prepareMail, spentSince } from "./quality-live";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import type { MailFamily } from "@/lib/emails/quality/families";
import type { Prospect } from "@/types";

const BUDGET_EUR = 0.2;
const count = Math.max(1, Number(process.argv[2]) || 4);

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const items = flatten((await loadToday(db as never, userId)).groups).filter((item) => item.kind === "nouveau" && item.prospectId).slice(Number(process.argv[3]) || 0, (Number(process.argv[3]) || 0) + count);
  const tally: Record<string, { n: number; ok: number }> = {};
  for (const item of items) {
    const { data } = await db.from("prospects").select("*").eq("id", item.prospectId!).maybeSingle();
    if (!data) continue;
    for (const family of ["F2", "F3", "F4"] as MailFamily[]) {
      if ((await spentSince(userId, started)) > BUDGET_EUR - 0.02) {
        console.log("Arrêt : plafond atteint.");
        break;
      }
      const { outcome } = await prepareMail({ ...(data as Prospect) }, userId, { family });
      if (!("body" in outcome)) {
        console.log(`\n=== ${item.companyName} ${family} : ${"blocked" in outcome ? outcome.blocked : outcome.error}`);
        continue;
      }
      tally[family] ??= { n: 0, ok: 0 };
      tally[family].n += 1;
      if (!outcome.needsReview) tally[family].ok += 1;
      console.log(`\n=== ${item.companyName} ${outcome.family} : ${outcome.score ?? "?"}/10 en ${outcome.attempts} essai(s)${outcome.needsReview ? ` → À revoir (${outcome.reviewReason})` : ""}\nObjet : ${outcome.subject}\n${outcome.body.split("\n\nSi le sujet")[0]}`);
    }
  }
  console.log(`\n${JSON.stringify(tally)} · coût OpenAI ${(await spentSince(userId, started)).toFixed(3)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
