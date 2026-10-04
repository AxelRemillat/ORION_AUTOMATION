/**
 * ITÉRATION QUALITÉ avec Cowork — `npm run iterate:quality -- <N>` (PAYANT, plafond 0,30 €).
 *
 * Génère les mails des prospects réels d'evals/quality/iteration.json SANS
 * RIEN ÉCRIRE (ni brouillon, ni fiche ; seul le journal de coût `api_usage`)
 * et sort le rapport attendu par Cowork : signal, pain, démo, salutation,
 * objet, mail (sans mention « stop » ni signature), mots, note du juge.
 * Rapport : evals/quality/iteration-N.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { db, ownerId, prepareMail, spentSince } from "./quality-live";
import { demoUrl, demoFor } from "@/lib/emails/quality/demo-links";
import { countWords } from "@/lib/emails/quality/template";
import type { Prospect } from "@/types";

const BUDGET_EUR = 0.3;
const iteration = Number(process.argv[2]) || 1;

const signalOf = (prospect: Prospect) => {
  const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
  const first = prospect.signals?.[0];
  const label = typeof figures.signal_label === "string" ? figures.signal_label : first?.label ?? "aucun";
  const date = typeof figures.signal_date === "string" ? figures.signal_date : first?.date ?? null;
  return date ? `${label} (${date})` : label;
};

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const cases = JSON.parse(readFileSync("evals/quality/iteration.json", "utf8")) as { match: string }[];
  const out: string[] = [`# Itération ${iteration} — ${started.slice(0, 16).replace("T", " ")} UTC`, ""];

  for (const item of cases) {
    if ((await spentSince(userId, started)) > BUDGET_EUR - 0.04) {
      out.push(`Arrêt : plafond de ${BUDGET_EUR} € atteint avant ${item.match}.`, "");
      break;
    }
    const { data } = await db.from("prospects").select("*").is("deleted_at", null).ilike("company_name", item.match).limit(1);
    const prospect = (data?.[0] as Prospect | undefined) ?? null;
    if (!prospect) {
      out.push(`## ${item.match} — introuvable`, "");
      continue;
    }
    const { outcome, greeting, brief } = await prepareMail(prospect, userId);
    out.push(`## ${prospect.company_name}`);
    if ("error" in outcome) {
      out.push(`Erreur : ${outcome.error}`, "");
      continue;
    }
    const core = outcome.body.split("\n\nSi le sujet ne vous concerne pas")[0].trim();
    const demo = brief ? demoUrl(demoFor(`${brief.pain.task} ${brief.pain.automationIdea}`)) : outcome.demo;
    out.push(
      `- Signal : ${signalOf(prospect)}`,
      `- Pain retenu : ${brief?.pain.task ?? "?"}`,
      `- Démo : ${demo}`,
      `- Salutation : ${greeting}`,
      `- Mots : ${countWords(core)} · note du juge : ${outcome.score ?? "?"}/10${outcome.needsReview ? ` (À revoir : ${outcome.reviewReason})` : ""} · essais : ${outcome.attempts}`,
      "",
      `Objet : ${outcome.subject}`,
      "",
      core,
      "",
    );
    console.log(`${prospect.company_name} : ${outcome.score}/10`);
  }
  const spent = await spentSince(userId, started);
  out.push(`Coût OpenAI de l'itération : ${spent.toFixed(3)} €.`);
  const file = `evals/quality/iteration-${iteration}.md`;
  writeFileSync(file, `${out.join("\n")}\n`);
  console.log(`Rapport : ${file} · ${spent.toFixed(3)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
