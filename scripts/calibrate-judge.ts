/**
 * CALIBRAGE DU DOUBLE JUGE des mails (grille de la famille + relecteur senior).
 *
 *   npm run calibrate:judge            un passage (PAYANT, ~0,03 €)
 *   npm run calibrate:judge -- --runs 2   deux passages, pour la stabilité
 *
 * Attendu : chaque POSITIF (mails validés par Axel, réécritures F2/F4, ANTARES
 * réécrit par Cowork) ≥ 9 aux DEUX juges ; chaque NÉGATIF (contre-exemples de
 * fond, originaux F2/F4, mails du 06/10 notés 6 à 8 par Cowork) < 9 au double
 * juge. Sort en erreur sinon. Aucune écriture en base, aucun envoi.
 */
import { liveAsk } from "./quality-live";
import { combineJudges, judgeMail, judgeMailSenior, PASS_SCORE } from "@/lib/emails/quality/judge";
import { COWORK_GRADED, FAMILY_REFERENCES, FOND_NEGATIVES, VALIDATED_POSITIVES } from "@/lib/emails/quality/calibration-set";
import { CALIBRATION } from "@/lib/emails/quality/references";
import { CTA_VARIANTS } from "@/lib/emails/quality/template";
import { DEMO_LINKS, demoForProposal } from "@/lib/emails/quality/demo-links";
import { assembleFamily, F4_WHO, type MailFamily } from "@/lib/emails/quality/families";

const runsIndex = process.argv.indexOf("--runs");
const runs = runsIndex >= 0 ? Math.max(1, Number(process.argv[runsIndex + 1]) || 1) : 1;

interface Case {
  label: string;
  family: MailFamily;
  company: string;
  subject: string;
  greeting: string;
  hook: string;
  proposal: string;
  demo: keyof typeof DEMO_LINKS;
  facts: string;
  expected: "positif" | "négatif";
}

const siteFacts = (company: string) => `- Activité (leur site) : faits cités dans le mail, lus sur le site de ${company}`;

function cases(): Case[] {
  const list: Case[] = [];
  for (const mail of VALIDATED_POSITIVES) {
    list.push({ label: "validé Axel", family: "F1", company: mail.company, subject: mail.subject, greeting: "Bonjour Madame Martin,", hook: mail.hook, proposal: mail.proposal, demo: demoForProposal(mail.proposal).key, facts: siteFacts(mail.company), expected: "positif" });
  }
  for (const mail of [...FOND_NEGATIVES, ...CALIBRATION.filter((item) => item.score < 9).map((item) => ({ ...item, subject: "Vos demandes" }))]) {
    list.push({ label: "négatif de fond", family: "F1", company: mail.company, subject: mail.subject, greeting: "Bonjour Madame Martin,", hook: mail.hook, proposal: mail.proposal, demo: demoForProposal(mail.proposal).key, facts: siteFacts(mail.company), expected: "négatif" });
  }
  for (const item of FAMILY_REFERENCES) {
    list.push({ label: `${item.family} ${item.why}`, family: item.family, company: item.company, subject: item.subject, greeting: "Bonjour Madame Martin,", hook: item.hook, proposal: item.family === "F4" ? F4_WHO : item.proposal, demo: item.family === "F4" ? "factures" : "emails", facts: item.facts, expected: item.expected });
  }
  for (const mail of COWORK_GRADED) {
    list.push({
      label: `Cowork 06/10 : ${mail.coworkScore}`,
      family: mail.family,
      company: mail.company,
      subject: mail.subject,
      greeting: mail.greeting,
      hook: mail.hook,
      proposal: mail.family === "F4" ? F4_WHO : mail.proposal,
      demo: mail.demo,
      facts: siteFacts(mail.company),
      expected: mail.coworkScore >= PASS_SCORE ? "positif" : "négatif",
    });
  }
  return list;
}

async function main() {
  let failures = 0;
  const all = cases();
  for (let run = 1; run <= runs; run += 1) {
    console.log(`\nPassage ${run}/${runs} — ${all.length} mails`);
    for (const item of all) {
      const body = assembleFamily(item.family, { subject: item.subject, hook: item.hook, proposal: item.proposal }, { greeting: item.greeting, demo: DEMO_LINKS[item.demo], cta: CTA_VARIANTS[0] });
      const [grid, senior] = await Promise.all([
        judgeMail(liveAsk(null), { subject: item.subject, body, company: item.company, facts: item.facts, family: item.family }, `qualite:calibrage:${run}`),
        judgeMailSenior(liveAsk(null), { subject: item.subject, body, company: item.company, facts: item.facts }, `qualite:calibrage-senior:${run}`),
      ]);
      // Mails validés le 05/10, avant la grille « 9–10 réels » du 06/10 : leur gabarit F1
      // (« J'automatise ce type de tâche pour des PME : … sont triés ») est au passif, ce que
      // la nouvelle grille exclut. Ils ne contrôlent plus que le juge de grille.
      const historical = item.label === "validé Axel";
      const combined = historical ? grid : combineJudges(grid, senior);
      const value = combined?.score ?? null;
      const ok = value !== null && (item.expected === "positif" ? value >= PASS_SCORE : value < PASS_SCORE);
      if (!ok) failures += 1;
      console.log(`  ${ok ? "ok  " : "ÉCART"} ${item.expected.padEnd(7)} ${item.company.slice(0, 28).padEnd(28)} grille ${grid?.score ?? "?"} · senior ${senior?.score ?? "?"} — ${item.label}`);
    }
  }
  console.log(failures ? `\n${failures} écart(s) de calibrage.` : "\nCalibrage conforme : positifs ≥ 9 aux deux juges, négatifs < 9.");
  process.exit(failures ? 1 : 0);
}

void main();
