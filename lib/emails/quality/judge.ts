import type { AskFn } from "@/lib/ai/chat";
import { CALIBRATION, COWORK_REFERENCES, TARGET_EXAMPLE } from "./references";
import { FOND_NEGATIVES, VALIDATED_POSITIVES } from "./calibration-set";
import { F2_INTRO, F4_WHO, FAMILY_LABELS, type MailFamily } from "./families";

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

/**
 * GRILLES DES FAMILLES F2 à F4 (expérience n° 2). Mêmes exigences de fond que
 * F1 — aucun fait inventé, rien d'affirmé comme un défaut du prospect, pas de
 * jargon, pas de flatterie — appliquées à ce que chaque famille fait écrire.
 * Pas encore de mails F2-F4 validés par Axel : leur calibrage se fera sur les
 * premiers validés.
 */
export const FAMILY_GRIDS: Record<Exclude<MailFamily, "F1">, readonly { id: string; points: number; rule: string }[]> = {
  F2: [
    { id: "besoin", points: 4, rule: `Après la présentation imposée (« ${F2_INTRO} »), le besoin probable : leur activité nommée PRÉCISÉMENT (produits, services, clientèle tirés de ce que l'on sait), puis une tâche qui revient souvent dans ce métier et ce qu'elle produit (client qui attend, devis tardif, double saisie). C'est un besoin PROBABLE, typique du métier, PAS une affirmation à vérifier : ne le qualifie jamais de « supposé », « hypothétique » ou « non établi » ; « peut retarder », « demande souvent » sont corrects. Ce qui DÉCRIT leur activité (produits, services, clientèle, « avions régionaux ») DOIT figurer dans « ce que l'on sait d'elle », sinon c'est un fait inventé (0) ; la tâche qui revient et sa conséquence sont, elles, des situations TYPES du métier : elles n'ont pas à y figurer et ne se qualifient jamais de « non sourcées ». 4 = activité précise et tâche concrète, dite simplement. 2 = activité générique (« dans votre secteur »). 1 = tâche abstraite ou tournure lourde (« revient souvent, avec une intervention qui attend »). 0 = fait inventé, défaut affirmé comme constaté chez eux, ou hypothèse visible.` },
    { id: "proposition", points: 3, rule: "À la PREMIÈRE PERSONNE et à la VOIX ACTIVE (« Je mets en place… », « J'automatise… ») : ce que je ferais chez eux, concrètement, pour CE besoin. 3 = geste concret + effet, on sait qui fait quoi. 1 = voix passive (« les demandes sont triées, puis une commande est préparée ») ou sans lien avec le besoin. 0 = étapes techniques ou jargon." },
    { id: "clarte", points: 2, rule: "Phrases simples et naturelles, mots du métier, aucun jargon, aucune tournure lourde ou alambiquée. 1 = une tournure maladroite." },
    { id: "naturel", points: 1, rule: "Écrit à la main par un indépendant, direct et poli, sans superlatif ni flatterie." },
  ],
  F3: [
    { id: "question", points: 4, rule: "UNE question courte sur QUI gère une tâche CONCRÈTE de leur métier, nommée avec leurs mots (« Qui confirme les délais de vos commandes de pièces sur mesure ? »). 4 = concrète, propre à leur activité, polie. 2 = tâche générique (« vos e-mails »). 0 = intrusive, accusatrice, ou fondée sur un fait inventé." },
    { id: "phrase", points: 3, rule: "« J'automatise… » : ce qui se fait tout seul pour CETTE tâche. 3 = geste concret lié à la question. 2 = générique. 1 = sans lien. 0 = jargon ou étapes techniques." },
    { id: "clarte", points: 2, rule: "Très court, mots simples, se lit en cinq secondes." },
    { id: "naturel", points: 1, rule: "Direct et poli, sans superlatif ni flatterie." },
  ],
  F4: [
    { id: "demo", points: 4, rule: `Après le lien (posé en première ligne), ce que fait la démo, HONNÊTEMENT : elle est GÉNÉRIQUE, faite sur un cas TYPE, pas sur leur métier ni leurs données. Attendu : « Elle lit une commande type et prépare la facture à valider ; le même principe s'appliquerait à vos commandes de vêtements professionnels. » 4 = cas type clair, résultat UTILE et concret (facture, devis, réponse au client, confirmation de délai, commande fournisseur), puis transposition explicite à leur activité. 2 = honnête mais résultat vague ou sans valeur (« prépare son classement dans la catégorie commandes »). 0 = laisse croire que la démo a été faite sur LEUR métier ou LEURS données (« Elle lit une commande de vêtements professionnels et prépare la facture »), promesse vague, fait inventé ou jargon. La ligne « ${F4_WHO} » est imposée : ne la note pas.` },
    { id: "lien", points: 3, rule: "Le cas décrit correspond à leur activité réelle (ce que l'on sait d'eux) et donne envie de cliquer. 3 = évident. 2 = plausible. 1 = lien faible. 0 = hors sujet." },
    { id: "clarte", points: 2, rule: "Mots simples, phrases courtes, aucun jargon." },
    { id: "naturel", points: 1, rule: "Direct et poli, sans superlatif ni flatterie." },
  ],
};

/** Exemples cibles des familles F2 à F4 (écrits pour le gabarit, pas encore validés par Axel). */
const FAMILY_TARGETS: Record<Exclude<MailFamily, "F1">, string> = {
  F2: `Bonjour Monsieur Gatine,\n\n${F2_INTRO}\n\nPour une entreprise qui fabrique des tubes et bouchons en carton, les demandes de prix arrivent avec des références variées. Un message mal aiguillé retarde la réponse au client.\n\nJe mets en place le tri de vos e-mails entre devis et commandes, et je transmets chacun à la bonne personne.\n\nUne démo proche de ce que vous pourriez avoir chez vous : axelremillat.com/automatisations?demo=email&v=2\n\nAuriez-vous 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?`,
  F3: `Bonjour Monsieur Gomez,\n\nQui confirme aujourd'hui les délais de vos commandes de tôlerie sur mesure ?\n\nJ'automatise ce tri : chaque commande reçue par e-mail est repérée et sa confirmation préparée.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=email&v=3\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?`,
  F4: `Bonjour Monsieur Jund,\n\nUne démo testable en une minute : axelremillat.com/agent?v=4\n\nElle lit une demande de devis type et prépare un brouillon à vérifier ; le même principe s'appliquerait à vos demandes de coffrets électriques sur mesure.\n\n${F4_WHO}\n\nSeriez-vous disponible 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?`,
};

/**
 * CONTRE-EXEMPLES RÉELS des familles F2 et F4 (relecture Cowork + Axel du
 * 05/10/2026 : premiers mails notés 10/10 trop généreusement).
 */
export const FAMILY_NEGATIVES: Record<Exclude<MailFamily, "F1">, { text: string; why: string }[]> = {
  F2: [
    { text: "En maintenance d'avions régionaux, vérifier les pièces disponibles et suivre les délais fournisseurs revient souvent, avec une intervention qui attend.", why: "Tournure lourde et maladroite (« revient souvent, avec une intervention qui attend ») : besoin 1 au plus, clarté 1." },
    { text: "Concrètement, les demandes de pièces reçues par e-mail sont triées, puis une commande fournisseur est préparée pour votre validation.", why: "Voix passive : on ne sait pas qui fait quoi. Proposition 1 au plus." },
  ],
  F3: [],
  F4: [
    { text: "Elle lit une commande de vêtements professionnels et prépare la facture client à valider.", why: "Laisse croire que la démo a été faite sur LEUR métier alors qu'elle est générique : démo 0." },
    { text: "Elle lit une commande type et prépare son classement dans la catégorie « commandes » à valider ; le même principe s'appliquerait à vos commandes de plants truffiers.", why: "Honnête, mais le résultat (un classement) n'apporte rien de concret au client : démo 2." },
  ],
};

const gridOf = (family: MailFamily): readonly { id: string; points: number; rule: string }[] => (family === "F1" ? GRID : FAMILY_GRIDS[family]);

export type CriterionId = (typeof GRID)[number]["id"];

export interface JudgeVerdict {
  score: number;
  criteria: Partial<Record<string, number>>;
  /** Ce qui coûte des points, en une phrase chacun. */
  reasons: string[];
  /** Consigne de réécriture, si la note est sous 9. */
  fix: string | null;
}

const asMail = (mail: { company: string; hook: string; proposal: string }) => `[${mail.company}]\n  Accroche : ${mail.hook}\n  Proposition : ${mail.proposal}`;

/** Positifs montrés au juge ; les autres servent de contrôle (calibrate-judge). */
export const PROMPT_POSITIVES = ["GRAPHIC PROCEDE", "CASTE ING", "CAREA SANITAIRE", "MAVIFLEX"];

export function buildJudgePrompt(family: MailFamily = "F1"): string {
  if (family !== "F1") return buildFamilyJudgePrompt(family);
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

/** Juge des familles F2 à F4 : même exigence de fond, grille de la famille. */
function buildFamilyJudgePrompt(family: Exclude<MailFamily, "F1">): string {
  const grid = FAMILY_GRIDS[family].map((criterion) => `- ${criterion.id} (${criterion.points} pt) : ${criterion.rule}`).join("\n");
  const below = [
    ...FAMILY_NEGATIVES[family].map((item) => `- « ${item.text} » → ${item.why}`),
    ...FOND_NEGATIVES.filter((mail) => mail.company !== "PROPOSITION HORS SUJET").map((mail) => `- ${mail.why}`),
  ].join("\n");
  const json = FAMILY_GRIDS[family].map((criterion) => `"${criterion.id}":0-${criterion.points}`).join(",");
  return `Tu relis des mails de prospection à froid qu'un indépendant (automatisation et IA pour PME) enverra à des dirigeants de PME françaises.
Ce mail suit la famille « ${FAMILY_LABELS[family]} ». Tu ne notes que le FOND de ce que la famille fait écrire ; la forme (salutation, présentation imposée, lien, demande finale, longueur, objet) est vérifiée par un programme : ne la reproche jamais.
Note sur 10 avec cette grille, en justifiant chaque point retiré :
${grid}

Seuil : 9/10 = envoyable tel quel. Un mail correct mais générique vaut 6 ou 7. 10/10 est rare : réserve-le à un mail que tu n'aurais rien à reprendre. Chaque point retiré doit correspondre à un défaut nommé dans « reasons » : sans défaut, pas de point retiré.

EXEMPLE CIBLE — 9 ou plus :
${FAMILY_TARGETS[family]}

DÉFAUTS DE FOND À SANCTIONNER (sous 9) :
${below}

Réponds UNIQUEMENT en JSON :
{"criteria":{${json}},"reasons":["…"],"fix":"consigne de réécriture précise sur le fond, ou null si 9 ou plus"}`;
}

export function parseVerdict(raw: string, family: MailFamily = "F1"): JudgeVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as { criteria?: Record<string, unknown>; reasons?: unknown; fix?: unknown };
  const criteria: Partial<Record<string, number>> = {};
  let score = 0;
  for (const criterion of gridOf(family)) {
    const raw = Number(value.criteria?.[criterion.id]);
    const points = Number.isFinite(raw) ? Math.max(0, Math.min(criterion.points, raw)) : 0;
    criteria[criterion.id] = points;
    score += points;
  }
  const reasons = Array.isArray(value.reasons) ? value.reasons.filter((line): line is string => typeof line === "string" && line.trim().length > 0).slice(0, 6) : [];
  const fix = typeof value.fix === "string" && value.fix.trim() ? value.fix.trim() : null;
  return { score: Math.round(score * 10) / 10, criteria, reasons, fix };
}

export async function judgeMail(
  ask: AskFn,
  input: { subject: string; body: string; company: string; facts: string; family?: MailFamily },
  operation = "qualite:juge",
): Promise<JudgeVerdict | null> {
  const family = input.family ?? "F1";
  const raw = await ask(
    "judge",
    buildJudgePrompt(family),
    `Entreprise : ${input.company}\nCe que l'on sait d'elle :\n${input.facts}\n\nMAIL À NOTER\nObjet : ${input.subject}\n\n${input.body}`,
    0,
    operation,
  ).catch(() => "");
  return parseVerdict(raw, family);
}
