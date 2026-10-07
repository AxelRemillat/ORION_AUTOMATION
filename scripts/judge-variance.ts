/**
 * VARIANCE DE LA CHECK-LIST (Cowork #32) sur des fiches réelles (PAYANT, plafond 1,00 €).
 *
 *   npm run eval:variance -- 15
 *
 * Pour chaque fiche : un mail est rédigé comme en production (rien n'est écrit
 * en base), puis la DERNIÈRE check-list (même prompt figé, même texte) est
 * rejouée 3 fois, chacune en majorité de CHECKLIST_SAMPLES lectures comme en
 * production. Affiche les critères à NON de chaque passage, et combien de
 * fiches changent de verdict « prêt » d'un passage à l'autre. Le texte complet
 * de chaque mail est imprimé (jeu d'étalonnage pour Cowork).
 */
import { db, liveAsk, ownerId, prepareMail, spentSince } from "./quality-live";
import { CHECKLIST_SAMPLES, deterministicChecks, majority, parseChecklistSample, semanticCriteria, verdictOf } from "@/lib/emails/quality/checklist";
import type { MailFamily } from "@/lib/emails/quality/families";
import type { AskFn } from "@/lib/ai/chat";
import type { Prospect } from "@/types";

const BUDGET_EUR = 1.0;
const PASSES = 3;
const count = Math.max(1, Number(process.argv[2]) || 15);

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const { data } = await (db as never as { from: (table: string) => any })
    .from("prospects")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("email", "is", null)
    .not("business_profile", "is", null)
    .order("created_at", { ascending: false })
    .limit(count * 3);
  const prospects = ((data ?? []) as Prospect[]).filter((prospect) => prospect.business_profile && Object.keys(prospect.business_profile).length).slice(0, count);
  const rows: string[] = [];
  const texts: string[] = [];
  let flips = 0;
  let measured = 0;
  for (const prospect of prospects) {
    if ((await spentSince(userId, started)) > BUDGET_EUR - 0.08) {
      rows.push("Arrêt : plafond atteint.");
      break;
    }
    const live = liveAsk(prospect.id);
    let captured: { system: string; user: string } | null = null;
    const ask: AskFn = (role, system, user, temperature, operation) => {
      if (role === "judge" && operation.startsWith("qualite:checklist")) captured = { system, user };
      return live(role, system, user, temperature, operation);
    };
    const { outcome, greeting } = await prepareMail({ ...prospect }, userId, { ask });
    const call = captured as { system: string; user: string } | null;
    if (!("body" in outcome)) {
      rows.push(`| ${prospect.company_name} | — | non rédigé | | |`);
      continue;
    }
    const family = outcome.family as MailFamily;
    const core = outcome.body.split("\n\nSi le sujet")[0];
    const code = deterministicChecks(core, { family, greeting });
    const passes: string[] = [];
    const ready: boolean[] = [];
    for (let pass = 0; pass < PASSES; pass += 1) {
      if (!call || code.some((item) => !item.ok)) {
        const verdict = verdictOf(code);
        passes.push(verdict.items.filter((item) => !item.ok).map((item) => item.id).join("+") || "prêt");
        ready.push(verdict.ready);
        continue;
      }
      const raws = await Promise.all(Array.from({ length: CHECKLIST_SAMPLES }, (_, index) => live("judge", call.system, call.user, 0, `qualite:variance:${pass}:${index}`).catch(() => "")));
      const semantic = majority(raws.map(parseChecklistSample), semanticCriteria(family));
      const verdict = semantic ? verdictOf([...code, ...semantic]) : null;
      passes.push(verdict ? verdict.items.filter((item) => !item.ok).map((item) => item.id).join("+") || "prêt" : "indisponible");
      ready.push(Boolean(verdict?.ready));
    }
    const flipped = new Set(ready).size > 1;
    if (flipped) flips += 1;
    measured += 1;
    rows.push(`| ${prospect.company_name} | ${family} | ${passes.join(" / ")} | ${flipped ? "OUI" : "non"} |`);
    texts.push(`### ${prospect.company_name} (${family})\n\nObjet : ${outcome.subject}\n\n${core}\n\n${(outcome.checklist?.items ?? code).map((item) => `- ${item.id} ${item.ok ? "OUI" : "NON"} — ${item.label} : « ${item.citation} »`).join("\n")}`);
  }
  console.log("| Fiche | Famille | Critères à NON (3 passages) | Verdict « prêt » change ? |");
  console.log("| --- | --- | --- | --- |");
  console.log(rows.join("\n"));
  console.log(`\nFiches dont le verdict « prêt » change d'un passage à l'autre : ${flips}/${measured}`);
  console.log(`Coût : ${(await spentSince(userId, started)).toFixed(3)} €`);
  console.log(`\n## Mails (texte complet et check-list du 1er jugement)\n\n${texts.join("\n\n")}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
