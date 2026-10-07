/**
 * JEU D'ÉTALONNAGE DE LA CHECK-LIST (Cowork #32) : les 15 fiches de la mesure
 * de variance du 06/10, leur dernier mail d'intro en base (texte complet) et
 * le verdict critère par critère.
 *
 *   npm run checklist:set              contrôles du code + critères du modèle (PAYANT, ~0,05 €)
 *   npm run checklist:set -- --code    contrôles du code seulement (gratuit)
 *
 * Rien n'est écrit en base. Modèle indisponible (quota) : C1 à C5 « en attente ».
 */
import { db, liveAsk, ownerId, spentSince } from "./quality-live";
import { deterministicChecks, judgeChecklist, type CriterionResult } from "@/lib/emails/quality/checklist";
import { isFamily, type MailFamily } from "@/lib/emails/quality/families";
import { keyFactsOf } from "@/lib/emails/quality/facts-gate";
import { buildFacts } from "@/lib/emails/derived-facts";
import type { Prospect } from "@/types";

export const CALIBRATION_COMPANIES = [
  "VENDREDI-SAMEDI-DIMANCHE-MAINTENANCE",
  "ICP LOGISTIQUE",
  "CAMEL DIAM",
  "DELIMBE",
  "CRISTAFLOR",
  "TRANSLOCAUTO",
  "BULLY",
  "INSTAN CARE",
  "PARCOME",
  "PLIMETAL",
  "ANTARES",
  "SOPRIMA",
  "ARIC",
  "IMAGINE OPTIC",
  "FIRSTPELLETS",
];

const codeOnly = process.argv.includes("--code");
const line = (item: CriterionResult) => `| ${item.id} | ${item.kind === "code" ? "code" : "modèle"} | ${item.ok ? "OUI" : "**NON**"} | ${item.citation.replace(/\|/g, "/").replace(/\n/g, " ")} |`;

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const loose = db as never as { from: (table: string) => any };
  const sections: string[] = [];
  for (const name of CALIBRATION_COMPANIES) {
    const { data: prospects } = await loose.from("prospects").select("*").eq("user_id", userId).ilike("company_name", `%${name}%`).is("deleted_at", null).limit(1);
    const prospect = (prospects ?? [])[0] as Prospect | undefined;
    if (!prospect) {
      sections.push(`### ${name}\n\nFiche introuvable.`);
      continue;
    }
    const { data: messages } = await loose.from("messages").select("id, subject, body, status, created_at").eq("prospect_id", prospect.id).eq("type", "intro").is("deleted_at", null).order("created_at", { ascending: false }).limit(1);
    const message = (messages ?? [])[0] as { id: string; subject: string | null; body: string; status: string; created_at: string } | undefined;
    if (!message) {
      sections.push(`### ${prospect.company_name}\n\nAucun mail d'intro en base.`);
      continue;
    }
    const { data: variant } = await loose.from("message_variants").select("family").eq("message_id", message.id).maybeSingle();
    const family: MailFamily = isFamily(variant?.family) ? variant.family : "F1";
    const core = message.body.replace(/\r\n/g, "\n").split("\n\nSi le sujet")[0].trim();
    const greeting = core.split(/\n\s*\n/)[0] ?? "";
    const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
    const keyFacts = keyFactsOf(figures);
    const facts = keyFacts?.length
      ? keyFacts.map((fact) => `- ${fact.text}${fact.process_hint ? ` (process : ${fact.process_hint})` : ""}`).join("\n")
      : buildFacts(prospect, null).facts.map((fact) => `- ${fact.label} : ${fact.value}`).join("\n");
    // D3 : la salutation stockée est celle que le code a posée ; on vérifie sa forme.
    const code = deterministicChecks(core, { family, greeting });
    const verdict = codeOnly
      ? null
      : await judgeChecklist(liveAsk(prospect.id), { subject: message.subject ?? "", core, family, greeting, company: prospect.company_name, facts, recipientRole: prospect.contact_role ?? null }, "qualite:checklist:etalonnage");
    const items = verdict?.items ?? code;
    const pending = !verdict && code.every((item) => item.ok) ? "\n\nC1 à C5 : en attente (modèle indisponible ou non demandé)." : "";
    sections.push(
      `### ${prospect.company_name} — ${family} · ${message.status} · ${message.created_at.slice(0, 10)}\n\nObjet : ${message.subject ?? ""}\n\n${core}\n\n| Critère | Juge | Verdict | Citation |\n| --- | --- | --- | --- |\n${items.map(line).join("\n")}${pending}${verdict ? `\n\n**${verdict.ready ? "PRÊT" : `À revoir (${verdict.score}/10)`}**` : ""}`,
    );
  }
  console.log(sections.join("\n\n---\n\n"));
  console.log(`\nCoût : ${(await spentSince(userId, started)).toFixed(3)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
