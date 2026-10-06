/**
 * MESURE FINALE de la chaîne « faits » (Cowork #31) sur des fiches réelles
 * (PAYANT, plafond 1,50 €). RIEN n'est écrit en base : les faits (agent1,
 * lib/enrichment/facts.ts) sont extraits EN MÉMOIRE quand la fiche n'en a pas.
 *
 *   npm run eval:facts -- 25
 *
 * Par fiche : faits (distinctivité), porte (« Faits insuffisants » = aucun
 * appel de rédaction), mail rédigé par la chaîne de production (ancrage sur le
 * meilleur fait, double juge, relecteur senior en médiane de 3, quota « Avec »
 * tenu sur la série). À la fin : taux de mails prêts (≥ 9) sur toutes les
 * fiches et sur celles qui passent la porte, fiches à préparer par jour pour
 * 20 mails prêts, 3 exemples avec le fait utilisé, coût.
 */
import { db, ownerId, prepareMail, spentSince } from "./quality-live";
import { extractFacts } from "@/lib/enrichment/facts";
import { liveFactsDeps, storedFacts } from "@/lib/enrichment/facts-server";
import { factsGate } from "@/lib/emails/quality/facts-gate";
import { hookOfBody, opensWithAvec } from "@/lib/emails/quality/readiness";
import { clichesOf } from "@/lib/emails/quality/rules";
import type { Prospect } from "@/types";

const BUDGET_EUR = 1.5;
const TARGET_READY_PER_DAY = 20;
const count = Math.max(1, Number(process.argv[2]) || 25);

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const { data } = await (db as never as { from: (table: string) => any })
    .from("prospects")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("email", "is", null)
    .not("website", "is", null)
    .not("business_profile", "is", null)
    .order("created_at", { ascending: false })
    .limit(count * 3);
  const prospects = ((data ?? []) as Prospect[]).filter((prospect) => prospect.business_profile && Object.keys(prospect.business_profile).length).slice(0, count);
  const lines: string[] = [];
  const examples: string[] = [];
  const usedCliches: string[] = [];
  const dayOpenings = { total: 0, avec: 0 };
  let examined = 0;
  let insufficient = 0;
  let drafted = 0;
  let ready = 0;
  let factsCost = 0;
  for (const prospect of prospects) {
    if ((await spentSince(userId, started)) > BUDGET_EUR - 0.08) {
      lines.push("Arrêt : plafond atteint.");
      break;
    }
    examined += 1;
    const figures = { ...((prospect.key_figures ?? {}) as Record<string, unknown>) };
    const before = await spentSince(userId, started);
    const facts = storedFacts(figures) ?? (await extractFacts(prospect.company_name, prospect.website!, liveFactsDeps(prospect.id)).catch(() => ({ facts: [] }))).facts;
    figures.facts = facts;
    factsCost += (await spentSince(userId, started)) - before;
    const gate = factsGate(figures);
    const best = facts.reduce((top, fact) => Math.max(top, fact.distinctiveness), 0);
    if (!gate.ok) {
      insufficient += 1;
      lines.push(`- ${prospect.company_name} · faits ${facts.length} (max ${best}/3) · Faits insuffisants`);
      continue;
    }
    const { outcome } = await prepareMail({ ...prospect, key_figures: figures as Prospect["key_figures"] }, userId, { usedCliches, dayOpenings });
    if (!("body" in outcome)) {
      lines.push(`- ${prospect.company_name} · faits max ${best}/3 · ${"blocked" in outcome ? `bloqué (${outcome.blocked})` : outcome.error}`);
      continue;
    }
    drafted += 1;
    const top = gate.facts?.[0];
    if (!outcome.needsReview) {
      ready += 1;
      usedCliches.push(...clichesOf(outcome.body));
      dayOpenings.total += 1;
      if (opensWithAvec(hookOfBody(outcome.body))) dayOpenings.avec += 1;
      if (examples.length < 3) examples.push(`${prospect.company_name} (${outcome.family}, ${outcome.score}/10) — fait utilisé : « ${top?.text} »${top?.process_hint ? ` · process : ${top.process_hint}` : ""}\n${outcome.body.split("\n\nSi le sujet")[0]}`);
    }
    lines.push(`- ${prospect.company_name} · faits max ${best}/3 · ${outcome.family} · ${outcome.score ?? "?"}/10${outcome.needsReview ? ` · À revoir : ${outcome.reviewReason}` : " · PRÊT"}`);
  }
  const spent = await spentSince(userId, started);
  const passRate = examined ? (examined - insufficient) / examined : 0;
  const gatedRate = drafted ? ready / drafted : 0;
  const allRate = examined ? ready / examined : 0;
  console.log(lines.join("\n"));
  console.log(`\nFiches examinées : ${examined} · « Faits insuffisants » : ${insufficient} · passent la porte : ${examined - insufficient} (${Math.round(100 * passRate)} %)`);
  console.log(`Mails prêts (≥ 9) : ${ready}/${drafted} rédigés (${Math.round(100 * gatedRate)} % des fiches qui passent la porte) · ${Math.round(100 * allRate)} % de toutes les fiches`);
  console.log(`Fiches à préparer par jour pour ${TARGET_READY_PER_DAY} mails prêts : ${allRate ? Math.ceil(TARGET_READY_PER_DAY / allRate) : "—"}`);
  console.log(`Coût : ${spent.toFixed(3)} € (faits ${factsCost.toFixed(3)} €) · ${ready ? (spent / ready).toFixed(3) : "—"} € par mail prêt`);
  if (examples.length) console.log(`\nExemples prêts :\n\n${examples.join("\n\n---\n\n")}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
