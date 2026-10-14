/**
 * ACCORD DU JUGE AVEC COWORK SUR L'A/B DU RÉDACTEUR (Cowork #58) — payant (~0,02 €).
 *
 *   USAGE_SOURCE=agent2 npx tsx scripts/calibrate-ab.ts [evals/redacteur-ab-2026-10-13.md]
 *
 * Relit les 20 mails du fichier d'éval et la notation de Cowork (section « Résultat »), juge chaque mail avec la
 * check-list réelle (mêmes faits et texte du site qu'en production) et compte l'accord : « prêt » chez le juge
 * ⇔ note Cowork ≥ 9. Un mail bloqué par une règle déterministe lors de l'A/B reste « non prêt », sauf si la
 * règle a été corrigée depuis (WENABI, Cowork #57). Cible Cowork : ≥ 17/20. Rien n'est écrit.
 */
import { readFileSync } from "node:fs";
import { db, liveAsk, ownerId, spentSince } from "./quality-live";
import { judgeChecklist } from "@/lib/emails/quality/checklist";
import { JOB_OFFER } from "@/lib/emails/quality/rules";
import { keyFactsOf } from "@/lib/emails/quality/facts-gate";
import { buildFacts } from "@/lib/emails/derived-facts";
import { storedProfile } from "@/lib/emails/business-profile";
import type { MailFamily } from "@/lib/emails/quality/families";
import type { Prospect } from "@/types";

const TARGET = 17;
/** Règle corrigée depuis l'A/B (Cowork #57) : le blocage « recrutement » est rejugé avec la règle actuelle. */
const RECRUITMENT_BLOCK = /Offre d'emploi ou recrutement/;

interface AbMail { index: number; company: string; family: MailFamily; letter: "A" | "B"; subject: string; core: string; blocked: boolean; cowork: number }

export function parseAb(markdown: string): AbMail[] {
  const notes = new Map<number, { A: number; B: number }>();
  for (const line of markdown.split("\n")) {
    const row = /^\|\s*(\d+)\s[^|]*\|[^|]*\|[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/.exec(line);
    if (row) notes.set(Number(row[1]), { A: Number(row[2]), B: Number(row[3]) });
  }
  const mails: AbMail[] = [];
  for (const section of markdown.split(/\n## /).slice(1)) {
    const head = /^(\d+)\. (.+)\n/.exec(section);
    if (!head) continue;
    const index = Number(head[1]);
    const family = (/Famille de mail : (F\d)/.exec(section)?.[1] ?? "F1") as MailFamily;
    for (const letter of ["A", "B"] as const) {
      const block = section.split(`### Mail ${letter}`)[1]?.split(/\n### Mail |\nNote Cowork/)[0] ?? "";
      const subject = /\*\*Objet : (.+)\*\*/.exec(block)?.[1] ?? "";
      const body = block.split(/\*\*Objet : .+\*\*\n\n/)[1]?.split(/\n\nJuge : /)[0] ?? "";
      const judgeLine = /Juge : (.+)/.exec(block)?.[1] ?? "";
      const recruitment = RECRUITMENT_BLOCK.test(judgeLine);
      const blocked = /^—\/10/.test(judgeLine) && (!recruitment || JOB_OFFER.test(`${subject} ${body}`));
      const note = notes.get(index)?.[letter];
      if (!body || note === undefined) continue;
      mails.push({ index, company: head[2].trim(), family, letter, subject, core: body.replace(/^Bonjour (Monsieur|Madame) \[Nom\],/, "Bonjour,").trim(), blocked, cowork: note });
    }
  }
  return mails;
}

async function main() {
  const file = process.argv[2] ?? "evals/redacteur-ab-2026-10-13.md";
  const mails = parseAb(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
  const userId = await ownerId();
  const started = new Date().toISOString();
  const loose = db as never as { from: (table: string) => any };
  let agree = 0;
  const rows: string[] = [];
  for (const mail of mails) {
    const name = mail.company.replace(/\s*\(.*$/, "").slice(0, 30);
    const { data } = await loose.from("prospects").select("*").eq("user_id", userId).ilike("company_name", `%${name}%`).is("deleted_at", null).limit(1);
    const prospect = (data ?? [])[0] as Prospect | undefined;
    const figures = (prospect?.key_figures ?? {}) as Record<string, unknown>;
    const facts = [
      ...(keyFactsOf(figures) ?? []).map((fact) => `- Fait vérifié (${fact.distinctiveness}/3) : ${fact.text}`),
      ...(prospect ? buildFacts(prospect, null).facts : []).map((fact) => `- ${fact.label} : ${fact.value}`),
      prospect && storedProfile(prospect.business_profile)?.offer ? `- Activité (leur site) : ${storedProfile(prospect.business_profile)?.offer}` : "",
    ].filter(Boolean).join("\n");
    const siteText = prospect ? [JSON.stringify(prospect.business_profile ?? {}), prospect.website ?? "", ...(prospect.signals ?? []).map((signal) => signal.label)].join(" ") : "";
    const verdict = mail.blocked ? null : await judgeChecklist(liveAsk(prospect?.id ?? null), { subject: mail.subject, core: mail.core, family: mail.family, greeting: mail.core.split("\n\n")[0] ?? "Bonjour,", company: prospect?.company_name ?? mail.company, facts, recipientRole: prospect?.contact_role ?? null, siteText }, "qualite:etalonnage-ab");
    const ready = Boolean(verdict?.ready);
    const ok = ready === mail.cowork >= 9;
    if (ok) agree += 1;
    const failed = mail.blocked ? "bloqué par une règle (A/B)" : verdict?.items.filter((item) => !item.ok).map((item) => item.id).join(" ") || "—";
    rows.push(`| ${mail.index}${mail.letter} ${mail.company.slice(0, 24)} | ${mail.cowork} | ${ready ? "prêt" : "non"} | ${ok ? "accord" : "**ÉCART**"} | ${failed} |`);
  }
  console.log("| Mail | Cowork | Juge | Accord | Critères à NON |\n| --- | --- | --- | --- | --- |");
  console.log(rows.join("\n"));
  console.log(`\nAccord avec Cowork : ${agree}/${mails.length} (cible ${TARGET}) · coût ${(await spentSince(userId, started)).toFixed(3)} €`);
  if (agree < TARGET) process.exitCode = 1;
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
