/**
 * CALIBRAGE DU JUGE sur le jeu de référence (lib/emails/quality/calibration-set.ts).
 *
 *   npm run calibrate:judge            un passage (PAYANT, ~0,02 €)
 *   npm run calibrate:judge -- --runs 2   deux passages, pour la stabilité
 *
 * Attendu : chaque POSITIF (mail validé par Axel) ≥ 9, chaque NÉGATIF < 9.
 * Sort en erreur sinon. Aucune écriture en base, aucun envoi.
 */
import { liveAsk } from "./quality-live";
import { judgeMail, PASS_SCORE, PROMPT_POSITIVES } from "@/lib/emails/quality/judge";
import { FAMILY_REFERENCES, FOND_NEGATIVES, VALIDATED_POSITIVES, type ReferenceMail } from "@/lib/emails/quality/calibration-set";
import { assembleFamily, F4_WHO } from "@/lib/emails/quality/families";
import { CALIBRATION } from "@/lib/emails/quality/references";
import { assemble, CTA_VARIANTS } from "@/lib/emails/quality/template";
import { demoForProposal, DEMO_LINKS } from "@/lib/emails/quality/demo-links";

const runsIndex = process.argv.indexOf("--runs");
const runs = runsIndex >= 0 ? Math.max(1, Number(process.argv[runsIndex + 1]) || 1) : 1;

/** Ce que le rédacteur avait sous les yeux : l'activité lue sur leur site. */
const factsOf = (mail: ReferenceMail) => `- Activité (leur site) : faits cités dans la première phrase de l'accroche, lus sur le site de ${mail.company}`;

async function score(mail: ReferenceMail, run: number): Promise<number | null> {
  const body = assemble({ subject: mail.subject, hook: mail.hook, proposal: mail.proposal }, { greeting: "Bonjour Madame Martin,", demo: demoForProposal(mail.proposal), cta: CTA_VARIANTS[0] });
  const verdict = await judgeMail(liveAsk(null), { subject: mail.subject, body, company: mail.company, facts: factsOf(mail) }, `qualite:calibrage:${run}`);
  return verdict?.score ?? null;
}

async function main() {
  const negatives: ReferenceMail[] = [
    ...FOND_NEGATIVES,
    ...CALIBRATION.filter((item) => item.score < 9).map((item) => ({ company: item.company, subject: "Vos demandes", hook: item.hook, proposal: item.proposal })),
  ];
  let failures = 0;
  for (let run = 1; run <= runs; run += 1) {
    console.log(`\nPassage ${run}/${runs}`);
    for (const mail of VALIDATED_POSITIVES) {
      const value = await score(mail, run);
      const ok = value !== null && value >= PASS_SCORE;
      if (!ok) failures += 1;
      console.log(`  ${ok ? "ok  " : "ÉCHEC"} positif ${PROMPT_POSITIVES.includes(mail.company) ? "(montré au juge)" : "(contrôle)      "} ${mail.company} : ${value ?? "?"}`);
    }
    for (const mail of negatives) {
      const value = await score(mail, run);
      const ok = value !== null && value < PASS_SCORE;
      if (!ok) failures += 1;
      console.log(`  ${ok ? "ok  " : "ÉCHEC"} négatif ${mail.company} : ${value ?? "?"}`);
    }
    // Familles F2 et F4 : cas réels relus le 05/10 (originaux sous 9, réécritures 9 ou plus).
    for (const item of FAMILY_REFERENCES) {
      const parts = { subject: item.subject, hook: item.hook, proposal: item.family === "F4" ? F4_WHO : item.proposal };
      const body = assembleFamily(item.family, parts, { greeting: "Bonjour Madame Martin,", demo: item.family === "F4" ? DEMO_LINKS.factures : DEMO_LINKS.emails, cta: CTA_VARIANTS[0] });
      const verdict = await judgeMail(liveAsk(null), { subject: item.subject, body, company: item.company, facts: item.facts, family: item.family }, `qualite:calibrage:${run}`);
      const value = verdict?.score ?? null;
      const ok = value !== null && (item.expected === "positif" ? value >= PASS_SCORE : value < PASS_SCORE);
      if (!ok) failures += 1;
      console.log(`  ${ok ? "ok  " : "ÉCHEC"} ${item.family} ${item.expected} ${item.company} : ${value ?? "?"} — ${item.why}`);
    }
  }
  console.log(failures ? `\n${failures} écart(s) de calibrage.` : "\nCalibrage conforme : positifs ≥ 9, négatifs < 9.");
  process.exit(failures ? 1 : 0);
}

void main();
