import type { AskFn } from "@/lib/ai/chat";
import { CALIBRATION, COWORK_REFERENCES, TARGET_EXAMPLE } from "./references";
import { FOND_NEGATIVES, VALIDATED_POSITIVES } from "./calibration-set";

/**
 * JUGE LLM (modèle léger, rôle `judge`) : une note sur 10 avec une grille
 * EXPLICITE, et la consigne de correction si la note est sous 9.
 *
 * Il ne note que le FOND (05/10/2026). La forme — longueur, mots interdits,
 * quota « Avec », démo cohérente, salutation, demande finale — est vérifiée et
 * corrigée par le code AVANT lui (rules.ts) : la payer deux fois faisait
 * perdre des points pour des choses déjà réglées.
 *
 * Calibrage sur le jeu de référence (calibration-set.ts) : les mails validés
 * par Axel le 05/10 doivent passer, les contre-exemples de fond rester sous
 * 9. Le seuil ne bouge pas : 9 — « envoyable sans retouche ».
 *
 * Diagnostic des 3 runs du 05/10 : 7 des 9 mails sous 9 perdaient leur point
 * sur une conséquence jugée « supposée » (« un message mal aiguillé retarde la
 * réponse »). Une conséquence TYPE de la tâche n'est pas une affirmation à
 * vérifier : Axel valide ces mails (GRAPHIC PROCEDE, « peut retarder »). Ce qui
 * reste sanctionné : un défaut AFFIRMÉ comme un fait sur le prospect, une
 * hypothèse visible, une conséquence abstraite.
 */

export const PASS_SCORE = 9;

export const GRID = [
  { id: "fait", points: 2, rule: "Phrase 1 : un FAIT PROPRE à l'entreprise, tiré de ce que l'on sait d'elle (produits ou gamme précis, type de clients, sites, services nommés), posé comme contexte de la tâche. Citer deux ou trois de leurs produits ou services suffit. 2 = propre à eux. 1 = vrai mais valable pour n'importe quelle entreprise du secteur. 0 = aucun fait, ouverture par le secteur, donnée de registre ou offre d'emploi." },
  { id: "consequence", points: 2, rule: "Phrase 2 : une situation CONCRÈTE et observable que cette tâche produit dans ce type d'entreprise (client qui attend, confirmation qui tarde, demande mal aiguillée, relance oubliée, double saisie, devis qui part tard). C'est une situation TYPE du métier, PAS une affirmation à vérifier : ne la qualifie jamais de « supposée » ni de « non vérifiable », et « retarde », « peut retarder », « laisse le client sans réponse » sont corrects. 2 = concrète. 1 = abstraite (« a des conséquences », « demande de l'attention ») ou qui décrit une étape de traitement sans effet. 0 = un défaut AFFIRMÉ comme un fait sur ce prospect (« vos clients se plaignent », « vous perdez des commandes ») ou une hypothèse visible (« si vos… »)." },
  { id: "proposition", points: 3, rule: "« J'automatise… » : ce qui se fait tout seul chez eux pour LA tâche de l'accroche, et ce que ça change. 3 = geste concret lié à l'accroche + effet. 2 = juste mais générique. 1 = sans lien avec l'accroche, ou empile les clichés (« sans ressaisie ni oubli »). 0 = liste d'étapes techniques ou jargon." },
  { id: "clarte", points: 2, rule: "Mots simples du métier du prospect, phrases courtes, aucun jargon (flux, workflow, « bout en bout », « efficacité opérationnelle »), se lit d'une traite." },
  { id: "naturel", points: 1, rule: "Écrit à la main par un indépendant ; direct et poli, sans superlatif, sans flatterie (« savoir-faire remarquable », « excellente réputation »)." },
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

const asMail = (mail: { company: string; hook: string; proposal: string }) => `[${mail.company}]\n  Accroche : ${mail.hook}\n  Proposition : ${mail.proposal}`;

/** Positifs montrés au juge ; les autres servent de contrôle (calibrate-judge). */
export const PROMPT_POSITIVES = ["GRAPHIC PROCEDE", "CASTE ING", "CAREA SANITAIRE", "MAVIFLEX"];

export function buildJudgePrompt(): string {
  const grid = GRID.map((criterion) => `- ${criterion.id} (${criterion.points} pt) : ${criterion.rule}`).join("\n");
  const cowork = COWORK_REFERENCES.map((mail) => `[${mail.company}]\n${mail.body}`).join("\n\n");
  const validated = VALIDATED_POSITIVES.filter((mail) => PROMPT_POSITIVES.includes(mail.company)).map(asMail).join("\n");
  const below = [
    ...FOND_NEGATIVES.map((mail) => `${asMail(mail)}\n  → sous 9 : ${mail.why}`),
    ...CALIBRATION.filter((item) => item.score < 9).map((item) => `${asMail(item)}\n  → ${item.score}/10 : ${item.why}`),
  ].join("\n");
  return `Tu relis des mails de prospection à froid qu'un indépendant (automatisation et IA pour PME) enverra à des dirigeants de PME françaises.
Tu ne notes que le FOND : l'accroche (fait propre puis conséquence) et la proposition. La forme est déjà vérifiée par un programme : salutation, longueur, lien de démo, demande finale, style de l'objet. Ne la reproche jamais.
Note sur 10 avec cette grille, en justifiant chaque point retiré :
${grid}

Seuil : 9/10 = envoyable tel quel. Un mail correct mais générique vaut 6 ou 7.

MAIL CIBLE — le niveau attendu :
${TARGET_EXAMPLE}

RÉFÉRENCES 10/10 (réécrites par le chef de projet) :
${cowork}

VALIDÉS PAR AXEL, ENVOYÉS TELS QUELS — 9 ou plus :
${validated}

SOUS 9 — défauts de fond à sanctionner :
${below}

Réponds UNIQUEMENT en JSON :
{"criteria":{"fait":0-2,"consequence":0-2,"proposition":0-3,"clarte":0-2,"naturel":0-1},"reasons":["…"],"fix":"consigne de réécriture précise sur le fond, ou null si 9 ou plus"}`;
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
