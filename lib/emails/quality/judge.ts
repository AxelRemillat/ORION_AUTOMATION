import type { AskFn } from "@/lib/ai/chat";
import { REFERENCE_MAILS, TARGET_EXAMPLE } from "./references";

/**
 * JUGE LLM (modèle léger, rôle `judge`) : une note sur 10 avec une grille
 * EXPLICITE, et la consigne de correction si la note est sous 9.
 *
 * La grille découpe la note en critères chiffrés : un juge qui doit justifier
 * chaque point note de façon bien plus stable qu'un juge qui « donne une note ».
 * Le seuil d'envoi est 9 — « envoyable sans retouche ».
 */

export const PASS_SCORE = 9;

export const GRID = [
  { id: "accroche", points: 3, rule: "Un fait concret et propre à CETTE entreprise (activité, sites, clientèle, façon dont arrivent les demandes), puis sa conséquence opérationnelle. Deux phrases courtes. 0 si elle cite une offre d'emploi, une donnée de registre, ou explique au prospect son propre métier." },
  { id: "proposition", points: 2, rule: "Une phrase, un bénéfice métier compréhensible par le dirigeant (temps gagné, erreurs ou retards évités). 0 si c'est une liste d'étapes techniques ou du jargon." },
  { id: "preuve", points: 1, rule: "Le lien de démo correspond au sujet de l'accroche." },
  { id: "clarte", points: 2, rule: "Mots simples du métier du prospect, phrases courtes, aucun jargon (flux, workflow, sigles), se lit d'une traite. Pas de formule creuse." },
  { id: "naturel", points: 1, rule: "On croirait le mail écrit à la main par un indépendant ; ton direct et poli, sans superlatif ni flatterie." },
  { id: "demande", points: 1, rule: "Une seule question, facile, en fin de mail. Longueur 60 à 90 mots." },
] as const;

export type CriterionId = (typeof GRID)[number]["id"];

export interface JudgeVerdict {
  score: number;
  criteria: Partial<Record<CriterionId, number>>;
  /** Ce qui coûte des points, en une phrase chacun. */
  reasons: string[];
  /** Consigne de réécriture, si la note est sous 9. */
  fix: string | null;
}

export function buildJudgePrompt(): string {
  const grid = GRID.map((criterion) => `- ${criterion.id} (${criterion.points} pt) : ${criterion.rule}`).join("\n");
  const references = REFERENCE_MAILS.map((mail) => `[${mail.company}]\n${mail.body}`).join("\n\n");
  return `Tu relis des mails de prospection à froid qu'un indépendant (automatisation et IA pour PME) enverra à des dirigeants de PME françaises.
Tu notes chaque mail sur 10 avec cette grille, en justifiant chaque point retiré :
${grid}

Seuil : 9/10 = envoyable tel quel, sans retouche. Sois exigeant : un mail correct mais générique vaut 6 ou 7.
La salutation, la ligne « Exemple testable en une minute : <lien> » et la demande finale sont imposées : ne les reproche pas, sauf si le lien ne correspond pas au sujet.

MAIL CIBLE — 9/10, le niveau attendu :
${TARGET_EXAMPLE}

RÉFÉRENCES — mails réellement envoyés, retenus pour la justesse de leur accroche. Ils datent d'un ancien gabarit : « flux », « Je suis Axel Remillat… » et l'absence de lien y sont des défauts que la grille actuelle sanctionne.
${references}

Réponds UNIQUEMENT en JSON :
{"criteria":{"accroche":0-3,"proposition":0-2,"preuve":0-1,"clarte":0-2,"naturel":0-1,"demande":0-1},"reasons":["…"],"fix":"consigne de réécriture précise, ou null si 9 ou plus"}`;
}

export function parseVerdict(raw: string): JudgeVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as { criteria?: Record<string, unknown>; reasons?: unknown; fix?: unknown };
  const criteria: Partial<Record<CriterionId, number>> = {};
  let score = 0;
  for (const criterion of GRID) {
    const raw = Number(value.criteria?.[criterion.id]);
    const points = Number.isFinite(raw) ? Math.max(0, Math.min(criterion.points, raw)) : 0;
    criteria[criterion.id] = points;
    score += points;
  }
  const reasons = Array.isArray(value.reasons) ? value.reasons.filter((line): line is string => typeof line === "string" && line.trim().length > 0).slice(0, 6) : [];
  const fix = typeof value.fix === "string" && value.fix.trim() ? value.fix.trim() : null;
  return { score: Math.round(score * 10) / 10, criteria, reasons, fix };
}

export async function judgeMail(ask: AskFn, input: { subject: string; body: string; company: string; facts: string }, operation = "qualite:juge"): Promise<JudgeVerdict | null> {
  const raw = await ask(
    "judge",
    buildJudgePrompt(),
    `Entreprise : ${input.company}\nCe que l'on sait d'elle :\n${input.facts}\n\nMAIL À NOTER\nObjet : ${input.subject}\n\n${input.body}`,
    0,
    operation,
  ).catch(() => "");
  return parseVerdict(raw);
}
