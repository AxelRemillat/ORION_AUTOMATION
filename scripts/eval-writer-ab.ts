/**
 * A/B EN AVEUGLE DU RÉDACTEUR (Cowork #56) : gpt-6-sol contre gpt-6-luna, sur des fiches réelles du stock.
 *
 *   USAGE_SOURCE=agent2 npx tsx scripts/eval-writer-ab.ts --out evals/redacteur-ab-AAAA-MM-JJ.md --key <fichier hors dépôt> [--n 10]
 *
 * Pour chaque fiche : MÊME brief stocké (aucun stratège), même famille, deux rédactions — l'une par le modèle
 * du rédacteur de prod, l'autre par le modèle léger — présentées A / B dans un ordre tiré au hasard. Le
 * fichier publié ne dit pas laquelle est laquelle ; la correspondance va dans `--key`, HORS du dépôt.
 * Aucune donnée personnelle : pas d'e-mail, la salutation est anonymisée. Rien n'est écrit en base (sauf
 * api_usage). Plafond de dépense : 0,50 € (`--cap`).
 */
import { writeFileSync } from "node:fs";
import { db, ownerId, prepareMail, spentSince } from "./quality-live";
import { validateBrief } from "@/lib/emails/strategist";
import { buildFacts } from "@/lib/emails/derived-facts";
import { factsGate } from "@/lib/emails/quality/facts-gate";
import { storedProfile } from "@/lib/emails/business-profile";
import type { QualityOutcome } from "@/lib/emails/quality/generate";
import type { Prospect } from "@/types";

const PROD_WRITER = process.env.OPENAI_MODEL_WRITER?.trim() || "gpt-6-sol";
const LIGHT_WRITER = "gpt-6-luna";
const arg = (name: string, fallback: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);

/** Corps sans données personnelles : salutation anonymisée, adresses retirées, signature coupée. */
export function anonymize(body: string): string {
  const core = body.split(/\n\s*\nSi le sujet ne vous concerne pas/)[0];
  return core
    .replace(/^Bonjour (Monsieur|Madame) [^,\n]+,/m, "Bonjour $1 [Nom],")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail]")
    .trim();
}

const verdictLine = (o: QualityOutcome) =>
  o.checklist?.items?.length
    ? o.checklist.items.map((item) => `${item.id} ${item.ok ? "OUI" : "NON"}`).join(" · ") + (o.reviewReason ? ` — ${o.reviewReason}` : "")
    : (o.reviewReason ?? "relecture indisponible");

async function draft(prospect: Prospect, userId: string, model: string, family?: QualityOutcome["family"]) {
  process.env.OPENAI_MODEL_WRITER = model;
  const result = await prepareMail(prospect, userId, family ? { family } : {});
  process.env.OPENAI_MODEL_WRITER = PROD_WRITER;
  return result.outcome as QualityOutcome | { error: string } | { blocked: string };
}

async function main() {
  const out = arg("--out", "evals/redacteur-ab.md");
  const keyFile = arg("--key", "");
  const n = Number(arg("--n", "10"));
  const cap = Number(arg("--cap", "0.5"));
  if (!keyFile) throw new Error("--key <fichier hors dépôt> obligatoire : la correspondance A/B ne va jamais dans le dépôt.");
  const userId = await ownerId();
  const started = new Date().toISOString();
  const loose = db as never as { from: (table: string) => any };
  const { data } = await loose.from("prospects").select("*").eq("user_id", userId).not("brief", "is", null).is("deleted_at", null).eq("do_not_contact", false).order("updated_at", { ascending: false }).limit(200);
  const { data: sent } = await loose.from("messages").select("prospect_id").eq("user_id", userId).eq("status", "sent");
  const contacted = new Set(((sent ?? []) as { prospect_id: string }[]).map((row) => row.prospect_id));
  const stock = ((data ?? []) as Prospect[]).filter((p) => {
    if (contacted.has(p.id) || !factsGate((p.key_figures ?? {}) as Record<string, unknown>).ok) return false;
    const facts = buildFacts(p, null);
    return Boolean(validateBrief(p.brief, { facts: facts.facts, companyName: facts.companyName, isLargeGroupSubsidiary: facts.isLargeGroupSubsidiary, parentGroup: null, foreignEntities: facts.foreignEntities, history: [], excludeAngles: [] } as never).brief);
  });

  const sections: string[] = [];
  const key: string[] = [];
  for (const prospect of stock) {
    if (sections.length >= n) break;
    if ((await spentSince(userId, started)) > cap) break;
    const prod = await draft(prospect, userId, PROD_WRITER);
    if (!("body" in prod)) continue;
    const light = await draft(prospect, userId, LIGHT_WRITER, prod.family);
    if (!("body" in light)) continue;
    const prodFirst = Math.random() < 0.5;
    const [a, b] = prodFirst ? [prod, light] : [light, prod];
    const index = sections.length + 1;
    key.push(`${index}. ${prospect.company_name} : A = ${prodFirst ? PROD_WRITER : LIGHT_WRITER}, B = ${prodFirst ? LIGHT_WRITER : PROD_WRITER}`);
    const profile = storedProfile(prospect.business_profile);
    sections.push(`## ${index}. ${prospect.company_name}

- Activité : ${profile?.offer ?? prospect.sector ?? "—"}
- Ville : ${prospect.city ?? "—"} · Famille de mail : ${prod.family}

### Mail A
**Objet : ${a.subject}**

${anonymize(a.body)}

Juge : ${a.score ?? "—"}/10 · ${verdictLine(a)}

### Mail B
**Objet : ${b.subject}**

${anonymize(b.body)}

Juge : ${b.score ?? "—"}/10 · ${verdictLine(b)}

Note Cowork — A : __/10 · B : __/10 · préféré : __`);
  }
  const spent = await spentSince(userId, started);
  writeFileSync(out, `# Rédacteur A/B en aveugle — ${started.slice(0, 10)}

${sections.length} fiches réelles du stock, même brief stocké (aucun stratège), même famille, deux rédactions. L'une vient du rédacteur de production, l'autre du modèle léger ; l'ordre A / B est tiré au hasard pour chaque fiche et n'est pas indiqué ici. Salutations anonymisées, aucune adresse e-mail. Coût de la mesure : ${spent.toFixed(3)} € (source agent2).

${sections.join("\n\n---\n\n")}
`);
  writeFileSync(keyFile, `${key.join("\n")}\n`);
  console.log(`${sections.length} fiches → ${out} · clé → ${keyFile} · ${spent.toFixed(3)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
