/**
 * ÉVAL du gabarit qualité — `npm run eval:quality` (PAYANT, ~0,3 €).
 *
 * Sur les cas fixés d'evals/quality/cases.json (données lues en base, en
 * lecture seule) : exclusion amont, puis génération complète (rédacteur,
 * garde-fou, juge, réécritures) SANS rien écrire — aucun brouillon, aucune
 * fiche modifiée. Le juge note aussi les 4 mails de référence d'origine.
 * Rapport : evals/quality/report-AAAA-MM-JJ.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { db, liveAsk, ownerId, prepareMail, spentSince } from "./quality-live";
import { offTargetReason } from "@/lib/funnel/off-target";
import { judgeMail } from "@/lib/emails/quality/judge";
import { REFERENCE_MAILS } from "@/lib/emails/quality/references";
import { countWords } from "@/lib/emails/quality/template";
import type { Prospect } from "@/types";

const BUDGET_EUR = 0.9;
interface Case {
  id: string;
  match: string;
  note: string;
}

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const cases = JSON.parse(readFileSync("evals/quality/cases.json", "utf8")) as Case[];
  const lines: string[] = [`# Éval qualité des mails — ${started.slice(0, 10)}`, "", "Gabarit « envoyable sans retouche », seuil 9/10. Juge : modèle léger (rôle `judge`).", ""];
  const scores: { id: string; score: number | null; review: boolean }[] = [];

  for (const item of cases) {
    if ((await spentSince(userId, started)) > BUDGET_EUR) {
      lines.push(`## ${item.id}`, "", `Arrêt : plafond de ${BUDGET_EUR} € atteint.`, "");
      break;
    }
    const { data } = await db.from("prospects").select("*").is("deleted_at", null).ilike("company_name", item.match).limit(1);
    const prospect = (data?.[0] as Prospect | undefined) ?? null;
    lines.push(`## ${item.id} — ${prospect?.company_name ?? "introuvable"}`, "", `_${item.note}_`, "");
    if (!prospect) continue;
    const excluded = offTargetReason(prospect);
    // L'éval n'envoie rien : une fiche opposée (BRIOL, BONNIN) est générée pour
    // étalonner le gabarit. Seule l'exclusion « signal pour un client » est testée.
    if (excluded && !excluded.startsWith("signal pour un client")) lines.push(`_Fiche ${excluded} : jamais envoyée, générée pour étalonnage._`, "");
    if (excluded?.startsWith("signal pour un client")) {
      lines.push(`**Exclu en amont, aucun brouillon** : ${excluded}`, "");
      scores.push({ id: item.id, score: null, review: false });
      console.log(`${item.id} : exclu (${excluded})`);
      continue;
    }
    const { outcome, greeting } = await prepareMail(prospect, userId, { readSite: true });
    if ("blocked" in outcome) {
      lines.push(`**À revoir, aucun mail** : ${outcome.blocked}`, "");
      console.log(`${item.id} : à revoir (${outcome.blocked})`);
      continue;
    }
    if ("error" in outcome) {
      lines.push(`**Erreur** : ${outcome.error}`, "");
      console.log(`${item.id} : erreur ${outcome.error}`);
      continue;
    }
    scores.push({ id: item.id, score: outcome.score, review: outcome.needsReview });
    const core = outcome.body.split("\n\nSi le sujet")[0];
    lines.push(
      `- Note du juge : **${outcome.score ?? "?"}/10** · essais : ${outcome.attempts} · ${outcome.needsReview ? `À REVOIR — ${outcome.reviewReason}` : "envoyable"}`,
      `- Salutation : ${greeting} · démo : ${outcome.demo} · ${countWords(core)} mots`,
      "",
      "```",
      `Objet : ${outcome.subject}`,
      "",
      outcome.body,
      "```",
      "",
    );
    for (const attempt of outcome.history) {
      lines.push(`  - essai : garde-fou ${attempt.rules.ok ? "ok" : `KO (${attempt.rules.failures.join(" ; ")})`}, check-list ${attempt.verdict ? (attempt.verdict.ready ? "prêt" : attempt.verdict.items.filter((item) => !item.ok).map((item) => `${item.id} NON`).join(", ")) : "—"}`);
    }
    lines.push("");
    console.log(`${item.id} : ${outcome.score}/10${outcome.needsReview ? " (à revoir)" : ""}`);
  }

  lines.push("## Mails de référence d'origine (ancien gabarit), notés par le même juge", "");
  for (const mail of REFERENCE_MAILS) {
    const verdict = await judgeMail(liveAsk(null), { subject: "", body: mail.body, company: mail.company, facts: "(mail de référence)" }, "qualite:juge:reference");
    lines.push(`- ${mail.company} : **${verdict?.score ?? "?"}/10** — ${(verdict?.reasons ?? []).join(" ; ") || "—"}`);
    console.log(`référence ${mail.company} : ${verdict?.score}/10`);
  }

  const spent = await spentSince(userId, started);
  lines.push("", `Coût OpenAI de l'éval : ${spent.toFixed(3)} €.`);
  const file = `evals/quality/report-${started.slice(0, 10)}.md`;
  writeFileSync(file, `${lines.join("\n")}\n`);
  console.log(`\nRapport : ${file} · coût ${spent.toFixed(3)} €`);
  console.log(JSON.stringify(scores));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
