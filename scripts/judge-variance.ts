/**
 * VARIANCE DES DEUX JUGES (Cowork #31) sur des fiches réelles (PAYANT, plafond 1,20 €).
 *
 *   npm run eval:variance -- 15
 *
 * Pour chaque fiche : un mail est rédigé comme en production (rien n'est écrit
 * en base), puis la DERNIÈRE paire de relectures (même prompt système, même
 * texte) est rejouée 3 fois — relecteur senior en médiane de 3 lectures, comme en production. Affiche les 3 notes de chaque juge, l'écart
 * max-min, et combien de fiches changent de verdict (≥ 9 ou non).
 */
import { db, liveAsk, ownerId, prepareMail, spentSince } from "./quality-live";
import { medianVerdict, PASS_SCORE, parseSeniorVerdict, parseVerdict, SENIOR_SAMPLES } from "@/lib/emails/quality/judge";
import type { MailFamily } from "@/lib/emails/quality/families";
import type { AskFn } from "@/lib/ai/chat";
import type { Prospect } from "@/types";

const BUDGET_EUR = 1.2;
const PASSES = 3;
const count = Math.max(1, Number(process.argv[2]) || 15);

interface Captured {
  system: string;
  user: string;
  operation: string;
}

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
  let flips = 0;
  let measured = 0;
  const spreads = { grid: [] as number[], senior: [] as number[], final: [] as number[] };
  for (const prospect of prospects) {
    if ((await spentSince(userId, started)) > BUDGET_EUR - 0.08) {
      rows.push("Arrêt : plafond atteint.");
      break;
    }
    const live = liveAsk(prospect.id);
    let grid: Captured | null = null;
    let senior: Captured | null = null;
    const ask: AskFn = (role, system, user, temperature, operation) => {
      if (role === "judge" && operation.startsWith("qualite:juge-senior")) senior = { system, user, operation };
      else if (role === "judge" && operation.startsWith("qualite:juge")) grid = { system, user, operation };
      return live(role, system, user, temperature, operation);
    };
    const { outcome } = await prepareMail({ ...prospect }, userId, { ask });
    const gridCall = grid as Captured | null;
    const seniorCall = senior as Captured | null;
    if (!("body" in outcome) || !gridCall || !seniorCall) {
      rows.push(`| ${prospect.company_name} | — | non rédigé | | | |`);
      continue;
    }
    const family = outcome.family as MailFamily;
    const gridScores: (number | null)[] = [];
    const seniorScores: (number | null)[] = [];
    for (let pass = 0; pass < PASSES; pass += 1) {
      const [g, s] = await Promise.all([
        live("judge", gridCall.system, gridCall.user, 0, `qualite:variance:juge:${pass}`).catch(() => ""),
        // Comme en production : médiane de SENIOR_SAMPLES lectures (lib/emails/quality/judge.ts).
        Promise.all(Array.from({ length: SENIOR_SAMPLES }, (_, index) => live("judge", seniorCall.system, seniorCall.user, 0, `qualite:variance:senior:${pass}:${index}`).catch(() => ""))),
      ]);
      gridScores.push(parseVerdict(g, family)?.score ?? null);
      seniorScores.push(medianVerdict(s.map(parseSeniorVerdict))?.score ?? null);
    }
    const finals = gridScores.map((g, index) => (g === null || seniorScores[index] === null ? null : Math.min(g, seniorScores[index]!)));
    const spread = (values: (number | null)[]) => {
      const known = values.filter((value): value is number => value !== null);
      return known.length ? Math.max(...known) - Math.min(...known) : 0;
    };
    const verdicts = new Set(finals.filter((value): value is number => value !== null).map((value) => value >= PASS_SCORE));
    const flipped = verdicts.size > 1;
    if (flipped) flips += 1;
    measured += 1;
    spreads.grid.push(spread(gridScores));
    spreads.senior.push(spread(seniorScores));
    spreads.final.push(spread(finals));
    const show = (values: (number | null)[]) => values.map((value) => value ?? "?").join(" / ");
    rows.push(`| ${prospect.company_name} | ${family} | ${show(gridScores)} | ${show(seniorScores)} | ${show(finals)} | ${flipped ? "OUI" : "non"} |`);
  }
  const mean = (values: number[]) => (values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : "—");
  console.log("| Fiche | Famille | Juge grille (3 passages) | Relecteur senior (3 passages) | Note retenue | Verdict change ? |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  console.log(rows.join("\n"));
  console.log(`\nÉcart moyen max-min : grille ${mean(spreads.grid)} · senior ${mean(spreads.senior)} · retenue ${mean(spreads.final)}`);
  console.log(`Fiches dont le verdict (≥ ${PASS_SCORE}) change d'un passage à l'autre : ${flips}/${measured}`);
  console.log(`Coût : ${(await spentSince(userId, started)).toFixed(3)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
