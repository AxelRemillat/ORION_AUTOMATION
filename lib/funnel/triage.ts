import { z } from "zod";
import { painForJob, painMapBlock } from "./pain-map";
import { applyTypeQuota } from "./quota";
import type { FilterVerdict, HarvestedSignal, Identity, Triage } from "./types";

/**
 * ÉTAGE 3 — tri LLM bon marché, par lots de 20, JSON strict.
 *
 * Le modèle juge ce que le code ne sait pas juger : le signal parle-t-il de
 * l'entreprise ou d'un de ses clients, y a-t-il une accroche simple. Le code
 * garde le dernier mot : plafond de score d'une modification juridique, pain
 * dicté par l'intitulé d'une offre, seuil de rétention.
 */

export const TRIAGE_BATCH = 20;
export const KEEP_SCORE = 4;
export const DEFAULT_TRIAGE_MODEL = "gpt-6-luna";

export const triageModel = (env: Record<string, string | undefined> = process.env) =>
  env.OPENAI_MODEL_TRIAGE?.trim() || DEFAULT_TRIAGE_MODEL;

const ITEM = z.object({
  id: z.string(),
  utilisable: z.boolean(),
  sujet_est_l_entreprise: z.boolean(),
  type: z.string().max(40),
  pain_probable: z.string().max(200),
  accroche_possible: z.string().max(300),
  score: z.number().min(0).max(5),
  raison: z.string().max(300),
});
const RESPONSE = z.object({ items: z.array(ITEM) });

export interface TriageInput {
  id: string;
  signal: HarvestedSignal;
  identity: Identity;
  verdict: FilterVerdict;
}

export interface TriageOutcome {
  id: string;
  triage: Triage | null;
  retained: boolean;
  reason: string | null;
}

export type TriageAsk = (system: string, user: string) => Promise<string>;

const SYSTEM = `Tu tries des signaux d'entreprises pour de la prospection B2B (automatisation de tâches répétitives).
Pour CHAQUE signal, réponds :
- utilisable : le signal révèle-t-il un vrai changement dans l'entreprise ?
- sujet_est_l_entreprise : FAUX si le signal parle d'un CLIENT, d'un partenaire ou d'une autre société (un cabinet qui conseille un groupe, une agence qui livre un client).
- type : direction | croissance | recrutement | implantation | reprise | autre
- pain_probable : la tâche répétitive probable, en vocabulaire métier.
- accroche_possible : UNE phrase simple, factuelle. Jamais « vous recrutez » : une offre d'emploi est un INDICE du pain, pas le sujet.
- score 0 à 5 : 5 = changement récent et engageant, sujet clair ; 0 = bruit.
- raison : une phrase.
Postes → pain :
${painMapBlock()}
Une modification purement juridique (forme, dénomination, transfert à une holding) vaut au plus 2.
Réponds UNIQUEMENT avec cet objet JSON, sans commentaire :
{"items":[{"id":"...","utilisable":true,"sujet_est_l_entreprise":true,"type":"...","pain_probable":"...","accroche_possible":"...","score":4,"raison":"..."}]}`;
/*
 * Le mot « JSON » doit figurer dans les messages : sans lui, l'API refuse
 * `response_format: json_object` avec un 400 (« 'messages' must contain the
 * word 'json' »). Le tri rendait alors « tri indisponible » sur CHAQUE signal —
 * 145 sur 145 — et l'erreur était avalée par le `catch` du lot.
 */

function userPrompt(batch: readonly TriageInput[]): string {
  return batch
    .map(({ id, signal, identity }) =>
      JSON.stringify({
        id,
        source: signal.source,
        date: signal.date,
        entreprise: identity.name,
        naf: identity.naf,
        effectif: identity.effectifCode,
        evenement: signal.facts.label,
        texte: signal.text.slice(0, 500),
        poste: signal.facts.jobTitle ?? undefined,
      }),
    )
    .join("\n");
}

/** Le code tranche après le modèle. */
export function settle(input: TriageInput, raw: z.infer<typeof ITEM> | undefined): TriageOutcome {
  if (!raw) return { id: input.id, triage: null, retained: false, reason: "tri indisponible pour ce signal" };
  const triage: Triage = { ...raw, score: Math.round(raw.score) };

  if (input.verdict.legalOnly) triage.score = Math.min(triage.score, 3);
  const jobPain = input.signal.source === "france-travail" ? painForJob(input.signal.facts.jobTitle ?? input.signal.text) : null;
  if (jobPain) triage.pain_probable = jobPain;
  if (/recrut|embauch|offre d'emploi|vous cherchez un/i.test(triage.accroche_possible)) {
    // L'offre est l'indice, pas le sujet : l'accroche est écartée, pas le signal.
    triage.accroche_possible = "";
  }

  const retained = triage.utilisable && triage.sujet_est_l_entreprise && triage.score >= KEEP_SCORE;
  const reason = retained
    ? null
    : !triage.sujet_est_l_entreprise
      ? "le signal parle d'un client ou d'une autre entreprise"
      : !triage.utilisable
        ? `signal inutilisable : ${triage.raison}`
        : `score ${triage.score}/5 sous le seuil de ${KEEP_SCORE}`;
  return { id: input.id, triage, retained, reason };
}

async function askBatch(ask: TriageAsk, batch: readonly TriageInput[]) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const answer = await ask(SYSTEM, userPrompt(batch));
      const parsed = RESPONSE.safeParse(JSON.parse(answer));
      if (parsed.success) return parsed.data.items;
      // Réponse lisible mais non conforme : on dit LAQUELLE des règles a sauté.
      // Sans cette trace, un lot entier ressortait « tri indisponible » sans
      // qu'on sache si le modèle avait répondu, mal répondu, ou pas répondu.
      console.warn(`[entonnoir] tri : réponse non conforme — ${parsed.error.issues[0]?.message ?? "?"}`);
    } catch (error) {
      console.warn(`[entonnoir] tri : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return [];
}

/** Tri de tous les signaux filtrés, par lots de 20. */
export async function triage(ask: TriageAsk, inputs: readonly TriageInput[]): Promise<TriageOutcome[]> {
  const outcomes: TriageOutcome[] = [];
  for (let index = 0; index < inputs.length; index += TRIAGE_BATCH) {
    const batch = inputs.slice(index, index + TRIAGE_BATCH);
    const items = await askBatch(ask, batch);
    const byId = new Map(items.map((item) => [item.id, item]));
    outcomes.push(...batch.map((input) => settle(input, byId.get(input.id))));
  }
  // Variété : un seul type ne peut pas rafler tous les retenus (cf. quota.ts).
  return applyTypeQuota(outcomes);
}
