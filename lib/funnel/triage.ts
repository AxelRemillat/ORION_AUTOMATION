import { z } from "zod";
import { effectifLabel } from "@/lib/enrichment/naf";
import { ageInMonths } from "./filter";
import { painForJob, painMapBlock } from "./pain-map";
import { applyTypeQuota, signalFamily } from "./quota";
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
  /** Motif de REJET : vide pour un signal retenu. */
  reason: string | null;
  /**
   * Information sur un signal retenu (« retenu pour la variété… »). Elle ne va
   * JAMAIS dans `motif_rejet` : le 30/09, deux fiches promues y portaient leur
   * note, et le creusage — qui ne prend que les fiches sans motif — les a
   * sautées pour toujours.
   */
  note?: string;
}

export type TriageAsk = (system: string, user: string) => Promise<string>;

const SYSTEM = `Tu tries des signaux d'entreprises pour de la prospection B2B (automatisation de tâches répétitives).
Pour CHAQUE signal, réponds :
- utilisable : le signal révèle-t-il un vrai changement dans l'entreprise ?
- sujet_est_l_entreprise : FAUX si le signal parle d'un CLIENT, d'un partenaire ou d'une autre société (un cabinet qui conseille un groupe, une agence qui livre un client).
- type : direction | croissance | recrutement | implantation | reprise | autre
- pain_probable : la tâche répétitive probable, en vocabulaire métier.
- accroche_possible : UNE phrase simple, factuelle. Jamais « vous recrutez » : une offre d'emploi est un INDICE du pain, pas le sujet.
- score 0 à 5 : 5 = changement récent et engageant, sujet clair, dans une entreprise qui a un back-office ; 0 = bruit.
- raison : une phrase.

CE QUE L'ON VEND : automatiser le back-office (devis, commandes, factures, relances, documents) d'une PME
de 10 salariés et plus. Un micro-commerce qui vend au grand public (restaurant, kebab, fleuriste, garderie,
coiffeur) n'a pas de back-office à automatiser : il vaut au plus 1, même si l'événement est récent.
Lis TOUJOURS naf, effectif, age_ans et ca : ils pèsent autant que l'événement.

pain_probable doit être SPÉCIFIQUE à ce signal et à cette activité (ce qu'ils vendent, à qui, comment).
Jamais une formule passe-partout comme « gestion des commandes et suivi des factures fournisseurs » :
deux entreprises différentes n'ont pas le même pain mot pour mot.

EXEMPLES NOTÉS (calibre-toi dessus) :
1. KEBAB DES ALPES — reprise d'un fonds de commerce, NAF 56.30Z, effectif non déclaré, créée il y a 3 mois, pas de CA → score 1 : micro-commerce B2C qui s'installe, aucun back-office.
2. GARDERIE PITCHOUN — nouveau gérant, NAF 88.91A (garde d'enfants), 10-19 salariés → score 1 : service aux familles, le changement de gérant ne crée pas de pain automatisable.
3. SARL BONNIN FRERES — boulangerie, 5 boutiques, 20-49 salariés, offre d'emploi → score 3 : vraie structure multi-sites, mais pain surtout de production ; accroche possible sur les commandes des boutiques.
4. ARTFLEX — grossiste, 21 salariés, CA en croissance → score 4 : négoce B2B en croissance, commandes et devis clients à absorber.
5. Entreprise de 30 salariés qui recrute un(e) assistant(e) ADV → score 5 : le poste EST le pain (saisie des commandes et des devis), sujet clair.
6. BRIOL DIFFUSION — menuiserie, 40 salariés, 3 showrooms, recrute → score 4 : devis et métrés multi-sites, pain concret.
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

/** Âge en années (une décimale), à partir de la date de création. */
const ageYears = (createdOn: string | null, now: Date) => {
  const months = ageInMonths(createdOn, now);
  return months === null ? null : Math.round((months / 12) * 10) / 10;
};

export function userPrompt(batch: readonly TriageInput[], now = new Date()): string {
  return batch
    .map(({ id, signal, identity }) =>
      JSON.stringify({
        id,
        source: signal.source,
        date: signal.date,
        entreprise: identity.name,
        naf: identity.naf,
        effectif: effectifLabel(identity.effectifCode) ?? "non déclaré",
        age_ans: ageYears(identity.createdOn, now),
        ca: identity.revenue != null ? `${Math.round(identity.revenue)} € (${identity.revenueYear ?? "année inconnue"})` : "non publié",
        evenement: signal.facts.label,
        texte: signal.text.slice(0, 500),
        poste: signal.facts.jobTitle ?? undefined,
      }),
    )
    .join("\n");
}

/** Pain comparé « mot pour mot » : casse, accents, ponctuation et espaces ignorés. */
export const normalizePain = (pain: string) =>
  pain
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Score maximal d'un signal dont le pain est identique, mot pour mot, à celui d'un autre. */
export const GENERIC_PAIN_MAX_SCORE = 3;

/**
 * Pain passe-partout : si deux fiches du run ont le même pain mot pour mot, le
 * modèle n'a rien lu de spécifique — leur score est plafonné à 3, donc sous le
 * seuil de rétention. Le 30/09, les 11 reprises retenues portaient toutes
 * « Suivi des commandes fournisseurs et des factures… » à quelques mots près.
 */
export function capGenericPains(outcomes: readonly TriageOutcome[]): TriageOutcome[] {
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    const key = outcome.triage ? normalizePain(outcome.triage.pain_probable) : "";
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return outcomes.map((outcome) => {
    const triage = outcome.triage;
    if (!triage || triage.score <= GENERIC_PAIN_MAX_SCORE) return outcome;
    if ((counts.get(normalizePain(triage.pain_probable)) ?? 0) < 2) return outcome;
    return {
      ...outcome,
      triage: { ...triage, score: GENERIC_PAIN_MAX_SCORE },
      retained: false,
      reason: `pain générique (identique mot pour mot à une autre fiche) : score plafonné à ${GENERIC_PAIN_MAX_SCORE}/5`,
    };
  });
}

/** Le code tranche après le modèle. */
export function settle(input: TriageInput, raw: z.infer<typeof ITEM> | undefined): TriageOutcome {
  if (!raw) return { id: input.id, triage: null, retained: false, reason: "tri indisponible pour ce signal" };
  const triage: Triage = { ...raw, score: Math.round(raw.score) };

  if (input.verdict.legalOnly) triage.score = Math.min(triage.score, 3);
  const jobPain =
    input.signal.source === "france-travail" ? painForJob(input.signal.facts.jobTitle ?? input.signal.text, input.signal.text) : null;
  // Offre d'emploi : le poste dicte la NATURE du pain (table), le modèle en
  // donne le contexte propre à l'entreprise. Deux ADV dans deux métiers
  // différents n'ont pas le même pain mot pour mot.
  if (jobPain) {
    const detail = raw.pain_probable.trim();
    triage.pain_probable =
      detail && !normalizePain(detail).includes(normalizePain(jobPain)) ? `${jobPain} : ${detail}` : jobPain;
  }
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

/** Réponse BRUTE du modèle pour un signal, avant les règles du code. */
export type TriageRaw = z.infer<typeof ITEM>;

/**
 * UN lot (20 signaux) : réponses brutes par id. Sert au tri découpé en étapes
 * (lib/funnel/stages.ts) : chaque lot est sauvegardé dès qu'il est trié.
 */
export async function askTriageBatch(ask: TriageAsk, batch: readonly TriageInput[]): Promise<Map<string, TriageRaw>> {
  const items = await askBatch(ask, batch);
  return new Map(items.map((item) => [item.id, item]));
}

/** Tri de tous les signaux filtrés, par lots de 20. */
export async function triage(ask: TriageAsk, inputs: readonly TriageInput[]): Promise<TriageOutcome[]> {
  const raws = new Map<string, TriageRaw>();
  for (let index = 0; index < inputs.length; index += TRIAGE_BATCH) {
    for (const [id, item] of await askTriageBatch(ask, inputs.slice(index, index + TRIAGE_BATCH))) raws.set(id, item);
  }
  return settleAll(inputs, raws);
}

/** Règles du code puis quotas, sur l'ENSEMBLE du run une fois tout trié. */
export function settleAll(inputs: readonly TriageInput[], raws: ReadonlyMap<string, TriageRaw | null | undefined>): TriageOutcome[] {
  const outcomes = inputs.map((input) => settle(input, raws.get(input.id) ?? undefined));
  // Pains passe-partout plafonnés, une offre par entreprise, puis variété : un
  // seul type de signal ne peut pas rafler les retenus (cf. quota.ts).
  const familyOf = new Map(inputs.map((input) => [input.id, signalFamily(input.signal)]));
  const sirenOf = new Map(inputs.map((input) => [input.id, input.identity.siren]));
  return applyTypeQuota(onePerCompany(capGenericPains(outcomes), sirenOf), (outcome) => familyOf.get(outcome.id) ?? "autre");
}

/**
 * UNE ENTREPRISE, UN RETENU.
 *
 * Rejeu national du 30/09/2026 : AJASSOCIES retenue trois fois (trois offres de
 * comptable copropriété), TYLS LAVAL deux fois. Le creusage refusait les
 * suivantes (« déjà en portefeuille »), mais elles prenaient des places dans
 * la liste et dans le quota. La mieux notée reste ; les autres sont écartées.
 */
export function onePerCompany(outcomes: readonly TriageOutcome[], sirenOf: ReadonlyMap<string, string | null | undefined>): TriageOutcome[] {
  const best = new Map<string, TriageOutcome>();
  for (const outcome of outcomes) {
    const siren = sirenOf.get(outcome.id);
    if (!outcome.retained || !siren) continue;
    const current = best.get(siren);
    if (!current || (outcome.triage?.score ?? 0) > (current.triage?.score ?? 0)) best.set(siren, outcome);
  }
  return outcomes.map((outcome) => {
    const siren = sirenOf.get(outcome.id);
    if (!outcome.retained || !siren || best.get(siren)?.id === outcome.id) return outcome;
    return { ...outcome, retained: false, reason: "doublon : une autre offre de la même entreprise est déjà retenue" };
  });
}
