/**
 * Tests du calcul de consommation et de cout.
 *
 * Ces chiffres pilotent des decisions d'achat : une erreur de division ou une
 * unite melangee se voit tout de suite sur la facture. On verrouille donc
 * l'agregation, le cout par prospect, et surtout la regle « la ressource la
 * plus limitante l'emporte », qui melange euros et unites natives.
 *
 * Execution : `npm run test:usage`.
 */
import { aggregate, perProspect, remainingProspects } from "../app/(app)/couts/_lib/aggregate";
import type { ApiService, ApiUsage } from "../types";
import type { ServiceBalance } from "../lib/usage/balances";
import {
  clampAnalysisLimit,
  DEFAULT_ANALYSIS_LIMIT,
  MAX_ANALYSIS_LIMIT,
} from "../lib/enrichment/limits";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const LABELS: Record<ApiService, string> = {
  openai: "OpenAI",
  pappers: "Pappers",
  linkup: "Linkup",
  hunter: "Hunter",
};

const row = (over: Partial<ApiUsage>): ApiUsage => ({
  id: "x",
  user_id: "u",
  service: "openai",
  operation: "test",
  units: 1,
  unit_cost: 0,
  cost: 0,
  prospect_id: null,
  created_at: "2026-09-20T10:00:00Z",
  ...over,
});

console.log("\n1. Agregation par service");
const totals = aggregate([
  row({ service: "openai", units: 4000, cost: 0.002 }),
  row({ service: "openai", units: 6000, cost: 0.003 }),
  row({ service: "pappers", units: 1, cost: 0 }),
  row({ service: "pappers", units: 1, cost: 0 }),
  row({ service: "linkup", units: 1, cost: 0.0046 }),
  row({ service: "hunter", units: 1, cost: 0 }),
]);
{
  const openai = totals.byService.find((e) => e.service === "openai");
  check("OpenAI : 2 appels", openai?.calls === 2);
  check("OpenAI : 10 000 tokens", openai?.units === 10000);
  check("total appels", totals.totalCalls === 6, String(totals.totalCalls));
  check(
    "cout total = somme des couts connus",
    Math.abs(totals.totalCost - 0.0096) < 1e-9,
    String(totals.totalCost),
  );
  check(
    "un service sans prix configure ne gonfle pas le total",
    totals.byService.find((e) => e.service === "pappers")?.cost === 0,
  );
}

console.log("\n2. Cout moyen par prospect");
{
  check("aucun prospect -> pas de moyenne", perProspect(totals, 0) === null);

  const avg = perProspect(totals, 4);
  check("moyenne = total / prospects", Math.abs((avg?.cost ?? 0) - 0.0024) < 1e-9);
  check("unites Pappers par prospect", Math.abs((avg?.units.pappers ?? 0) - 0.5) < 1e-9);
  check("unites OpenAI par prospect", Math.abs((avg?.units.openai ?? 0) - 2500) < 1e-9);
}

console.log("\n3. Prospects restants : la ressource la plus limitante gagne");
{
  const avg = perProspect(totals, 4)!;
  const balances: ServiceBalance[] = [
    // 18 € restants / 0,00125 € par prospect = enorme -> non limitant
    { service: "openai", remaining: 18, unit: "€", quality: "estime", basis: "budget" },
    // 10 credits / 0,5 credit par prospect = 20 prospects -> LE limitant
    { service: "pappers", remaining: 10, unit: "crédit", quality: "exact", basis: "compte" },
    // 19 € / 0,00115 € = enorme
    { service: "linkup", remaining: 19, unit: "€", quality: "exact", basis: "solde" },
    // solde inconnu : ne doit pas limiter
    { service: "hunter", remaining: null, unit: "recherche", quality: "estime", basis: "inconnu" },
  ];

  const estimate = remainingProspects(balances, avg, LABELS);
  check("une estimation est produite", estimate !== null);
  check("le limitant est Pappers", estimate?.limiting === "pappers", estimate?.limiting);
  check("20 prospects restants", estimate?.prospects === 20, String(estimate?.prospects));
  check("qualite reprise du solde limitant", estimate?.exact === true);
  check(
    "un solde inconnu ne limite jamais",
    !estimate?.basis.includes("Hunter"),
    estimate?.basis,
  );
}

console.log("\n4. Aucun solde connu -> aucune estimation inventee");
{
  const avg = perProspect(totals, 4)!;
  const blind: ServiceBalance[] = [
    { service: "openai", remaining: null, unit: "€", quality: "estime", basis: "inconnu" },
    { service: "pappers", remaining: null, unit: "crédit", quality: "estime", basis: "inconnu" },
  ];
  check("pas d'estimation", remainingProspects(blind, avg, LABELS) === null);
}

console.log("\n5. Plafond d'analyse : aucune saisie ne doit faire exploser la facture");
{
  check("defaut a 3", DEFAULT_ANALYSIS_LIMIT === 3);
  check("valeur normale conservee", clampAnalysisLimit(7) === 7);
  check("borne haute respectee", clampAnalysisLimit(500) === MAX_ANALYSIS_LIMIT);
  check("borne basse respectee", clampAnalysisLimit(0) === 1);
  check("negatif ramene a 1", clampAnalysisLimit(-12) === 1);
  check("decimal tronque", clampAnalysisLimit(4.9) === 4);
  check("absent -> defaut", clampAnalysisLimit(undefined) === DEFAULT_ANALYSIS_LIMIT);
  check("texte -> defaut", clampAnalysisLimit("beaucoup") === DEFAULT_ANALYSIS_LIMIT);
}

console.log(
  failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`,
);
process.exit(failures === 0 ? 0 : 1);
