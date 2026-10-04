import type { AskFn } from "@/lib/ai/chat";
import { CALIBRATION, COWORK_REFERENCES, REFERENCE_MAILS, TARGET_EXAMPLE } from "./references";

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
  { id: "accroche", points: 3, rule: "Un FAIT PROPRE vérifiable (nombre de sites ou de fournils, gamme précise, type de clients, zone, produit phare), posé comme CONTEXTE, puis une conséquence OBSERVABLE (client qui attend, retard de livraison, double saisie, relance oubliée, devis qui part tard). 3 = les deux, nets. 2 = fait propre mais conséquence un peu générique. 1 = conséquence molle (« prend du temps », « peut prendre du temps ») ou fait trop vague. 0 = ouverture par le secteur (« Dans le commerce de gros »), description du métier (« X travaille dans… », « Vous vendez / fabriquez… »), offre d'emploi, donnée de registre, ou pain supposé." },
  { id: "proposition", points: 2, rule: "Une phrase, ce qui se fait tout seul chez eux et le bénéfice métier. 1 si une hypothèse est visible (« si vos demandes… ») ou si elle empile les clichés (« sans ressaisie ni oubli »). 0 si c'est une liste d'étapes techniques ou du jargon." },
  { id: "preuve", points: 1, rule: "Le lien de démo illustre ce que dit la phrase « J'automatise… » (agent devis → la phrase parle de préparer un devis ; démo e-mails → tri, aiguillage ou commandes reçues par e-mail). 0 si la phrase et le lien parlent de deux choses différentes." },
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
  const cowork = COWORK_REFERENCES.map((mail) => `[${mail.company}]\n${mail.body}`).join("\n\n");
  const calibration = CALIBRATION.map(
    (item) => `[${item.company}] ${item.score}/10 — ${item.why}\n  Accroche : ${item.hook}\n  Proposition : ${item.proposal}`,
  ).join("\n");
  return `Tu relis des mails de prospection à froid qu'un indépendant (automatisation et IA pour PME) enverra à des dirigeants de PME françaises.
Tu notes chaque mail sur 10 avec cette grille, en justifiant chaque point retiré :
${grid}

Seuil : 9/10 = envoyable tel quel, sans retouche. Sois exigeant : un mail correct mais générique vaut 6 ou 7. Dans le doute entre deux notes, prends la plus basse.
La salutation, la ligne « Exemple testable en une minute : <lien> » et la demande finale sont imposées : ne les reproche pas, sauf si le lien ne correspond pas au sujet.

MAIL CIBLE — 9/10, le niveau attendu :
${TARGET_EXAMPLE}

RÉFÉRENCES 10/10 (réécrites par le chef de projet) :
${cowork}

ÉTALONNAGE — notes données par le chef de projet ; tu dois retrouver ces notes à ±0,5 :
${calibration}

RÉFÉRENCES ANCIENNES — mails réellement envoyés, retenus pour la justesse de leur accroche. Ils datent d'un ancien gabarit : « flux », « Je suis Axel Remillat… » et l'absence de lien y sont des défauts que la grille actuelle sanctionne.
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
