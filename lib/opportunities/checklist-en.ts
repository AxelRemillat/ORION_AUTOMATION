import { PROPOSAL_POSITIVES } from "./calibration";
import { DELAY_EN, delayDaysEn, firstSentence, UPWORK_FIXED_CAP_USD, UPWORK_HOOK_MAX_CHARS, UPWORK_HOURLY_CAP_USD, UPWORK_MAX_CHARS, usdAmounts, usdRange, WEAK_OPENING } from "./platforms";
import type { ProjectKind } from "./requests";
import type { ProposalCriterionId } from "./proposal-checklist";

/**
 * CHECK-LIST ANGLAISE (Upwork) — la grille d'Axel en 8 points (moteur de
 * check-list d'agent2, #32 : P1 à P8, OUI/NON avec citation), traduite et
 * adaptée à Upwork : aperçu de la 1re phrase, 1 200 caractères, prix fixe OU
 * horaire en dollars.
 *
 * Écrite comme une CONFIGURATION du moteur, pas comme un second moteur :
 *   - les 8 points portent l'identifiant du critère qu'ils remplacent ;
 *   - P5 et P7 (code) sont lus par `upworkCodeChecks` ;
 *   - P1, P3, P4, P6 (lecture du modèle) par `upworkChecklistPrompt`, au même
 *     format JSON que la consigne française ;
 *   - P2 et P8 restent ceux du moteur (montants en dollars acceptés pour P2).
 */

export interface ChecklistItem {
  id: ProposalCriterionId;
  label: string;
  rule: string;
}

export interface ChecklistConfig {
  id: string;
  language: "en" | "fr";
  items: readonly ChecklistItem[];
}

export const UPWORK_CHECKLIST: ChecklistConfig = {
  id: "upwork-en",
  language: "en",
  items: [
    { id: "P1", label: "Hook in the preview, need clearly read", rule: "The FIRST sentence (the only one the client sees in the list) names THEIR concrete problem or outcome, with their tools or volumes — no « Hello », no « I am… », no self-introduction — and the proposal shows the post was read (tools, documents, expected result)." },
    { id: "P2", label: "Every request answered", rule: "Every item the post asks for (approach, price, timeline, examples…) gets an explicit answer, in the order asked." },
    { id: "P3", label: "Concrete approach", rule: "A concrete approach in 3 steps, fitted to their tools and constraints — not generic steps (« discuss », « test », « set up a solution »)." },
    { id: "P4", label: "Closest proof, honest", rule: "The closest proof to their need (a working demo of a similar case); honest about what has not been done yet; nothing invented — no fake clients, no made-up results. If the post asks for no references and a close demo is cited: YES. Axel's Upwork portfolio has only four projects (AI email triage with n8n + OpenAI, invoice data extraction, a custom AI quote agent, the ORION prospecting platform): the « Related project in my Upwork portfolio » line, added by a program, cites the nearest of these with its demo — that IS the closest proof available, so YES even when it is not the exact same use case; NO only if the text claims an exact past project or a client it does not have." },
    { id: "P5", label: "One price, one timeline", rule: "ONE price — a fixed amount OR an hourly rate, in US dollars — and ONE timeline, consistent with the budget and with a freelancer new on Upwork." },
    { id: "P6", label: "One useful question", rule: "The final question moves THEIR project forward (volume, tool, format, sample files) — never generic (« when can we start? », « any questions? »)." },
    { id: "P7", label: "Short, hook first, signed", rule: `Short: ${UPWORK_MAX_CHARS.toLocaleString("en-US")} characters at most, opens on the hook, signed « Axel Remillat ».` },
    { id: "P8", label: "Plain, direct English", rule: "Plain, direct English: no email, phone, calendar link or invitation to talk off Upwork; no flattery, no jargon (leverage, seamless, cutting-edge…), no invented references." },
  ],
};

const LLM_IDS = ["P1", "P3", "P4", "P6"] as const;

/** Consigne FIGÉE du modèle pour P1, P3, P4, P6 (même JSON que la consigne française du moteur). */
export function upworkChecklistPrompt(): string {
  const rules = UPWORK_CHECKLIST.items.filter((item) => (LLM_IDS as readonly string[]).includes(item.id));
  const examples = PROPOSAL_POSITIVES.filter((item) => item.platform === "upwork")
    .map((item) => `--- ${item.title} ---\n${item.text}`)
    .join("\n\n");
  return `You are the CLIENT who posted this job on Upwork. You receive 50 proposals and only see the FIRST sentence of each in your list. You do NOT give a score: you answer YES (true) or NO (false) to each criterion, with an EXACT QUOTE from the proposal (for a NO: the faulty passage, or the closest one to what is missing).
Form (length, price and timeline, contact details, signature) is checked by a program: do not judge it.

${rules.map((item) => `${item.id} — ${item.rule}`).join("\n")}

PROPOSALS THAT TICK EVERYTHING (other jobs):
${examples}

Reply ONLY in JSON: {"P1":{"ok":true|false,"citation":"…"},"P3":{…},"P4":{…},"P6":{…}}`;
}

export interface UpworkCodeChecks {
  /** P5 : un prix (fixe ou horaire, en dollars) et un délai, identiques aux champs, dans le positionnement. */
  price: { ok: boolean; citation: string };
  /** P7 : accroche en tête, 1 200 caractères au plus (la signature est vérifiée par le moteur). */
  shape: { ok: boolean; citation: string };
}

/** P5 et P7 pour Upwork, sur le texte final et son corps (sans la signature). */
export function upworkCodeChecks(
  text: string,
  body: string,
  context: { amountEur: number | null; delayDays: number | null; kind?: ProjectKind },
): UpworkCodeChecks {
  const kind = context.kind ?? "automatisation";
  const prices = usdAmounts(body);
  const range = usdRange(body);
  const fixedTop = Math.max(0, ...prices.filter((item) => !item.hourly).map((item) => item.value));
  const hourlyTop = Math.max(0, ...prices.filter((item) => item.hourly).map((item) => item.value));
  const delay = delayDaysEn(body);
  const problems = [
    prices.length ? "" : "no price in US dollars",
    range ? `price range « ${range} »` : "",
    !range && new Set(prices.map((item) => `${item.value}${item.hourly ? "h" : ""}`)).size > 1 ? `${prices.length} different prices` : "",
    context.amountEur != null && prices.length && !prices.some((item) => item.value === context.amountEur) ? `price in text ≠ bid $${context.amountEur}` : "",
    DELAY_EN.test(body) ? "" : "no timeline",
    context.delayDays != null && delay !== null && delay !== context.delayDays ? `timeline ${delay} days ≠ field ${context.delayDays} days` : "",
    fixedTop > UPWORK_FIXED_CAP_USD[kind] ? `$${fixedTop} above positioning` : "",
    hourlyTop > UPWORK_HOURLY_CAP_USD ? `$${hourlyTop}/hr above positioning` : "",
  ].filter(Boolean);
  const hook = firstSentence(text);
  const shapeProblems = [
    text.length > UPWORK_MAX_CHARS ? `${text.length} characters (> ${UPWORK_MAX_CHARS})` : "",
    WEAK_OPENING.test(hook) ? `weak opening « ${hook.slice(0, 50)} »` : "",
    hook.length > UPWORK_HOOK_MAX_CHARS ? `hook of ${hook.length} characters` : "",
  ].filter(Boolean);
  return {
    price: { ok: problems.length === 0, citation: problems.join(" ; ") || `${prices.map((item) => `$${item.value}${item.hourly ? "/hr" : ""}`).join(", ")} · ${delay ?? "—"} days` },
    shape: { ok: shapeProblems.length === 0, citation: shapeProblems.join(" ; ") || `${text.length} characters · hook « ${hook.slice(0, 60)} »` },
  };
}
