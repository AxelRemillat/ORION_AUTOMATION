import { isOpenAIQuotaError } from "@/lib/ai/quota";
import type { AskFn } from "@/lib/ai/chat";
import { AXEL_SENT } from "./calibration";
import { CODEUR_LAUNCH_MAX_EUR, contactFailures, FLATTERY, INVENTED_CLAIMS, isNoContactPlatform, PRIVATE_MESSAGE_MAX_CHARS, PROPOSAL_JARGON } from "./proposal";
import { DELAY_CAP_DAYS, developmentAmounts, honestReferences, longestDelayDays, PRICE_CAP_EUR, priceRange, requestedItems, type ProjectKind } from "./requests";
import type { Platform } from "./types";
// Plateformes #1 (agent4) : Upwork branché en CONFIGURATION (checklist-en.ts), le moteur reste celui de #32.
import { upworkChecklistPrompt, upworkCodeChecks } from "./checklist-en";
import { usdAmounts } from "./platforms";

/**
 * CHECK-LIST DES PROPOSITIONS (Cowork #32) — la grille d'Axel en 8 points,
 * chacun OUI/NON avec une citation, plus de note globale.
 *
 *   Code : P2 éléments demandés, P5 prix et délai (identiques aux champs, dans
 *          le positionnement), P7 longueur + salutation + signature,
 *          P8 ton (coordonnées, flatterie, jargon, références inventées).
 *   LLM  : P1 lecture du besoin, P3 approche, P4 preuve, P6 question —
 *          un appel JSON rejoué PROPOSAL_CHECKLIST_SAMPLES fois, majorité.
 *
 * « Prête » = les 8 à OUI. Les 3 propositions réellement envoyées par Axel
 * (P1 Sage, P2 fichiers de prix, P3 tri de pièces) passent à 100 %.
 */

/** Crédit OpenAI épuisé : on le fait SUIVRE (le job s'arrête proprement) ; toute autre panne = lecture illisible. */
const keepQuota = (error: unknown): string => {
  if (isOpenAIQuotaError(error)) throw error;
  return "";
};

export type ProposalCriterionId = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8";

export interface ProposalCriterion {
  id: ProposalCriterionId;
  label: string;
  kind: "code" | "llm";
  ok: boolean;
  citation: string;
}

export interface ProposalChecklist {
  items: ProposalCriterion[];
  ready: boolean;
  score: number;
}

export const PROPOSAL_CRITERIA: Record<ProposalCriterionId, { label: string; kind: "code" | "llm"; penalty: number }> = {
  P1: { label: "Lecture précise du besoin (ses outils, ses documents, son résultat attendu)", kind: "llm", penalty: 2 },
  P2: { label: "Réponse explicite à chaque élément demandé par l'annonce", kind: "code", penalty: 2 },
  P3: { label: "Approche concrète, adaptée à ses outils et contraintes", kind: "llm", penalty: 2 },
  P4: { label: "Preuve la plus proche du besoin, références honnêtes", kind: "llm", penalty: 1 },
  P5: { label: "Un prix et un délai uniques, identiques aux champs, dans le positionnement", kind: "code", penalty: 2 },
  P6: { label: "Une question de cadrage utile, qui fait avancer le devis", kind: "llm", penalty: 1 },
  P7: { label: "Courte, « Bonjour, » en tête, signée « Axel Remillat »", kind: "code", penalty: 1 },
  P8: { label: "Ton direct : ni coordonnées, ni flatterie, ni jargon, ni références inventées", kind: "code", penalty: 2 },
};

export const PROPOSAL_CHECKLIST_SAMPLES = 3;
const LLM_IDS = ["P1", "P3", "P4", "P6"] as const;

export interface ProposalContext {
  platform: Platform;
  /** Annonce complète (les éléments demandés en sont lus). */
  ad: string;
  budget: string | null;
  amountEur: number | null;
  delayDays: number | null;
  kind?: ProjectKind;
}

const blocksOf = (text: string) => text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);

/** P2, P5, P7, P8 : contrôles déterministes sur le texte final (salutation et signature comprises). */
export function proposalCodeChecks(text: string, context: ProposalContext): ProposalCriterion[] {
  const result = (id: ProposalCriterionId, ok: boolean, citation: string): ProposalCriterion => ({ id, label: PROPOSAL_CRITERIA[id].label, kind: "code", ok, citation });
  const blocks = blocksOf(text);
  const signature = blocks[blocks.length - 1] ?? "";
  // Upwork (agent4) : pas de salutation, le 1er bloc est l'accroche — il fait partie du corps.
  const upwork = context.platform === "upwork";
  const body = blocks.slice(upwork ? 0 : 1, -1).join("\n\n");
  const kind = context.kind ?? "automatisation";

  // P2 — chaque élément demandé a sa réponse.
  const requested = requestedItems(context.ad);
  const approachWords = blocks
    .slice(1, -1)
    .filter((block) => !/^(prix|mensuel|délai|références?)\s*:/i.test(block) && !block.trim().endsWith("?"))
    .join(" ")
    .split(/\s+/).length;
  const missing = requested.filter((item) =>
    item === "approche"
      ? approachWords < 30
      : item === "prix"
        ? developmentAmounts(body).length === 0 && !(upwork && usdAmounts(body).length > 0)
        : item === "couts_mensuels"
          ? !/(mensuel|par mois|\/\s?mois|per month|monthly)/i.test(body)
          : item === "delai"
            ? longestDelayDays(body) === null
            : !(/(r[ée]f[ée]rences?|portfolio|d[ée]mo|ORION)/i.test(body) && honestReferences(body)),
  );

  // P5 — un prix, un délai, identiques aux champs, dans le positionnement.
  const amounts = developmentAmounts(body);
  const range = priceRange(body);
  const delay = longestDelayDays(body);
  const top = Math.max(0, ...amounts, context.amountEur ?? 0);
  const priceProblems = [
    range ? `fourchette « ${range} »` : "",
    context.amountEur != null && amounts.length && !amounts.includes(context.amountEur) ? `prix du texte ${amounts.join(", ")} € ≠ champ ${context.amountEur} €` : "",
    context.delayDays != null && delay !== null && delay !== context.delayDays ? `délai du texte ${delay} j ≠ champ ${context.delayDays} j` : "",
    top > PRICE_CAP_EUR[kind] ? `${top} € au-delà du positionnement` : "",
    kind === "automatisation" && top > CODEUR_LAUNCH_MAX_EUR && !/(erp|sage|sql|connexion|extranet|webservice|installation|import)/i.test(`${body} ${context.ad}`) ? `${top} € sans projet multi-systèmes` : "",
    delay !== null && delay > DELAY_CAP_DAYS[kind] ? `délai de ${delay} jours trop long` : "",
  ].filter(Boolean);
  const priced = amounts.length > 0 || !requested.includes("prix");
  // Upwork (agent4) : P5 et P7 lus par la configuration anglaise (dollars, fixe ou horaire ; accroche, 1 200 caractères).
  const upworkChecks = upwork ? upworkCodeChecks(text, body, context) : null;

  // P7 — courte, salutation, signature.
  const length = text.length;
  const lengthOk = !isNoContactPlatform(context.platform) || length <= PRIVATE_MESSAGE_MAX_CHARS;
  const shapeOk = blocks[0] === "Bonjour," || blocks[0] === "Hello,";
  const signed = /^Axel Remillat\b/.test(signature);

  // P8 — ton.
  const tone = [...contactFailures(text, context.platform), body.match(FLATTERY)?.[0], body.match(PROPOSAL_JARGON)?.[0], body.match(INVENTED_CLAIMS)?.[0]].filter((hit): hit is string => Boolean(hit));

  return [
    result("P2", missing.length === 0, missing.length ? `sans réponse : ${missing.join(", ")}` : requested.length ? `demandés : ${requested.join(", ")}` : "rien de demandé explicitement"),
    upworkChecks
      ? result("P5", upworkChecks.price.ok, upworkChecks.price.citation)
      : result("P5", priced && priceProblems.length === 0, priceProblems.join(" ; ") || `${amounts.join(", ") || "—"} € · ${delay ?? "—"} j`),
    upworkChecks
      ? result("P7", upworkChecks.shape.ok && signed, `${upworkChecks.shape.citation} · signature « ${signature.slice(0, 40)} »`)
      : result("P7", lengthOk && shapeOk && signed, `${length} caractères · « ${blocks[0] ?? ""} » · signature « ${signature.slice(0, 40)} »`),
    result("P8", tone.length === 0, tone.length ? tone.join(" ; ") : "aucun"),
  ];
}

/** Prompt FIGÉ : les données vont dans le message. Repères : les 3 propositions envoyées par Axel. */
export function buildProposalChecklistPrompt(platform?: Platform): string {
  // Upwork (agent4) : mêmes critères P1, P3, P4, P6, consigne en anglais (checklist-en.ts).
  if (platform === "upwork") return upworkChecklistPrompt();
  return `Tu es le CLIENT qui a publié l'annonce. Tu ne donnes PAS de note : tu réponds OUI (true) ou NON (false) à chaque critère, avec une CITATION EXACTE de la réponse (pour un NON : le passage fautif, ou le plus proche de ce qui manque).
La forme (longueur, prix et délai, coordonnées, signature) est vérifiée par un programme : ne la juge pas.

P1 — La réponse montre qu'il a lu TON besoin : elle reprend tes outils, tes documents, ton résultat attendu (dans une reformulation ou directement dans l'approche). NON si c'est une paraphrase vague (« automatiser vos tâches »).
P3 — L'approche dit concrètement ce qui sera fait, dans l'ordre, avec TES outils et contraintes (en liste ou en un paragraphe). NON si les étapes sont passe-partout (« définir avec vous », « tester », « mettre en place une solution »).
P4 — La preuve citée est la plus proche de ton besoin (une réalisation du portfolio au titre exact, ou ORION pour la prospection ou une application web) et les références sont honnêtes (« pas encore de projet Sage » suivi d'une démo réelle = OUI). NON si une référence est inventée ou sans rapport. Si l'annonce ne demande pas de références et que la réponse cite une démo proche : OUI.
P6 — La question finale fait avancer TON devis (volume, outil, format, fichiers types). NON si elle est générique (« avez-vous des questions ? »).

RÉPONSES RÉELLES QUI COCHENT TOUT (à d'autres annonces) :
${AXEL_SENT.map((item) => `--- ${item.title} ---\n${item.text}`).join("\n\n")}

Réponds UNIQUEMENT en JSON : {"P1":{"ok":true|false,"citation":"…"},"P3":{…},"P4":{…},"P6":{…}}`;
}

type Sample = Partial<Record<ProposalCriterionId, { ok: boolean; citation: string }>>;

export function parseProposalChecklist(raw: string): Sample | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const sample: Sample = {};
  for (const id of LLM_IDS) {
    const entry = (value as Record<string, unknown>)[id] as { ok?: unknown; citation?: unknown } | undefined;
    if (entry && typeof entry.ok === "boolean") sample[id] = { ok: entry.ok, citation: typeof entry.citation === "string" ? entry.citation.trim() : "" };
  }
  return Object.keys(sample).length === LLM_IDS.length ? sample : null;
}

/** Majorité par critère ; égalité → NON. `null` si aucune lecture lisible. */
export function proposalMajority(samples: readonly (Sample | null)[]): ProposalCriterion[] | null {
  const read = samples.filter((sample): sample is Sample => Boolean(sample));
  if (!read.length) return null;
  return LLM_IDS.map((id) => {
    const votes = read.map((sample) => sample[id]!);
    const yes = votes.filter((vote) => vote.ok).length;
    const ok = yes > votes.length - yes;
    const witness = votes.find((vote) => vote.ok === ok && vote.citation) ?? votes.find((vote) => vote.ok === ok);
    return { id, label: PROPOSAL_CRITERIA[id].label, kind: "llm" as const, ok, citation: witness?.citation ?? "" };
  });
}

const ORDER: ProposalCriterionId[] = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"];

export function proposalVerdictOf(items: ProposalCriterion[]): ProposalChecklist {
  const sorted = [...items].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const score = Math.max(0, 10 - sorted.filter((item) => !item.ok).reduce((sum, item) => sum + PROPOSAL_CRITERIA[item.id].penalty, 0));
  return { items: sorted, ready: sorted.length === ORDER.length && sorted.every((item) => item.ok), score };
}

/**
 * Check-list complète : le code d'abord ; la lecture du modèle seulement si
 * le code passe. `null` = relecture indisponible.
 */
export async function judgeProposalChecklist(
  ask: AskFn,
  input: { title: string; text: string } & ProposalContext,
  operation = "opportunites:checklist",
  samples = PROPOSAL_CHECKLIST_SAMPLES,
): Promise<ProposalChecklist | null> {
  const code = proposalCodeChecks(input.text, input);
  if (code.some((item) => !item.ok)) return proposalVerdictOf(code);
  const user = `ANNONCE « ${input.title} » (budget : ${input.budget ?? "non indiqué"})\n${input.ad.slice(0, 5000)}\n\nRÉPONSE REÇUE\n${input.text}`;
  const raws = await Promise.all(
    Array.from({ length: Math.max(1, samples) }, (_, index) => ask("judge", buildProposalChecklistPrompt(input.platform), user, 0, index ? `${operation}:lecture-${index + 1}` : operation).catch(keepQuota)),
  );
  const semantic = proposalMajority(raws.map(parseProposalChecklist));
  if (!semantic) return null;
  return proposalVerdictOf([...code, ...semantic]);
}

export function proposalChecklistFeedback(verdict: ProposalChecklist): string {
  return verdict.items
    .filter((item) => !item.ok)
    .map((item) => `- ${item.id} NON — ${item.label}${item.citation ? ` : « ${item.citation} »` : ""}`)
    .join("\n");
}

export function proposalChecklistReason(verdict: ProposalChecklist): string {
  const failed = verdict.items.filter((item) => !item.ok);
  if (!failed.length) return "";
  return `${failed.length} critère(s) à NON — ${failed[0].id} ${failed[0].label}${failed[0].citation ? ` : « ${failed[0].citation} »` : ""}`;
}
