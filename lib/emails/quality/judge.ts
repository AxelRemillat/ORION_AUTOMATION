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
    { id: "question", points: 4, rule: "UNE question courte sur QUI gère une tâche CONCRÈTE de leur métier ou de leur traitement des commandes (« Qui confirme les délais de vos commandes de pièces sur mesure ? », « Qui trie et classe les documents qui accompagnent vos commandes clients ? » = 4). 2 = tâche floue (« vos e-mails », « votre administratif »). 0 = intrusive, accusatrice, ou fondée sur un fait inventé." },
    { id: "phrase", points: 3, rule: "« J'automatise… » : ce qui se fait tout seul pour CETTE tâche. 3 = geste concret lié à la question. 2 = générique. 1 = sans lien. 0 = jargon ou étapes techniques." },
    { id: "clarte", points: 2, rule: "Très court, mots simples, se lit en cinq secondes. 0 = mot à DOUBLE SENS dans leur métier (« pièces administratives » chez un fabricant de pièces mécaniques) ou tournure lourde (« documents des dossiers de pièces de précision »)." },
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
  F3: [
    { text: "Qui gère les pièces administratives de vos commandes ? J'automatise le tri des documents des dossiers de pièces de précision.", why: "« Pièces administratives » chez un fabricant de pièces mécaniques : double sens ; « documents des dossiers de pièces de précision » : lourd ; lien de démo générique. 6/10 (ANTARES, 06/10)." },
  ],
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

/**
 * SECOND JUGE (Cowork, 06/10/2026) : le « relecteur exigeant », un consultant
 * B2B senior qui doit SIGNER le mail. Sa grille est celle de Cowork : un mail
 * n'est « Nouveau » que s'il coche TOUT. Les deux juges doivent donner 9 ou plus.
 * Étalonné sur les notes réelles de Cowork du 06/10 (SOPRIMA 8, PLIMETAL 8,
 * ARIC 7,5, BULLY 7,5, CAMEL DIAM 7,5, ANTARES 6 ; ANTARES réécrit 9).
 */
export const SENIOR_GRID = [
  "Un fait SPÉCIFIQUE et sourcé sur l'entreprise (produit, clientèle, service, process vu sur le site), pas une reformulation générique du secteur. Pour une question courte (F3), c'est la question elle-même qui doit nommer une tâche propre à leur métier.",
  "Un problème crédible directement lié à CE fait (et au rôle du destinataire quand on le connaît).",
  "Une proposition à la 1re personne, concrète, avec un résultat visible (ce qui arrive, ce qui est signalé, ce que le client reçoit) — pas « prépare son classement ».",
  "Une démo cohérente avec la proposition.",
  "Aucune tournure lourde ou ambiguë (mot à double sens dans leur métier), aucun passif inutile.",
  "Un seul appel à l'action, simple.",
] as const;

/** Exemples d'étalonnage complets (mails réels) : 9 = signable, sous 9 = notes de Cowork du 06/10. */
const SENIOR_ANCHORS = [
  { score: 9, text: "Entre tubes, bouchons et embouts en carton ou plastique, les demandes reçues par e-mail portent sur des références variées. Un message mal aiguillé retarde la réponse au client. / J'automatise ce type de tâche pour des PME : les e-mails reçus sont triés entre demandes de devis et commandes, puis transmis à la bonne personne pour préparer la réponse.", why: "fait précis (leurs produits), conséquence concrète, résultat visible" },
  { score: 9, text: "Chez Carea, les rendez-vous conseil cuisine portent notamment sur les plans de travail et les éviers. Après l'échange, le client attend son devis pour avancer dans son projet. / J'automatise ce type de tâche pour des PME : les références et les dimensions convenues alimentent un devis préparé pour votre validation, afin que le client reçoive sa proposition plus vite.", why: "process propre à l'entreprise, résultat pour le client" },
  { score: 9, text: "(question courte) Qui trie et classe les documents qui accompagnent vos commandes clients ? / J'automatise ce classement : chaque document reçu est lu, rangé dans le bon dossier et les informations manquantes sont signalées avant validation.", why: "tâche concrète, résultat clair, aucun mot ambigu" },
  { score: 8, text: "(démo d'abord) Elle lit une demande type et prépare un brouillon de devis à valider ; le même principe s'appliquerait à vos demandes de devis pour l'application de produits de freinage et d'étanchéité.", why: "bon fait, mais aucun problème posé et un résultat minimal" },
  { score: 8, text: "(question courte) Qui prépare les demandes de devis reçues par e-mail pour votre bureau d'étude ? / J'automatise la lecture des e-mails et pièces jointes, le préremplissage des demandes et le signalement des informations manquantes.", why: "question générique (« votre bureau d'étude »), proposition en liste d'actions" },
  { score: 7.5, text: "(démo d'abord) Elle lit une demande type et prépare un brouillon de réponse à valider ; le même principe s'appliquerait à vos demandes d'étude d'éclairage.", why: "fait moyen (une catégorie de demandes), aucun problème" },
  { score: 7.5, text: "Avec les transports à la carte et les demandes de devis en ligne, chaque trajet nécessite des informations précises. Un détail manquant retarde l'envoi du devis au client. / J'automatise ce type de tâche pour des PME : les demandes en ligne alimentent votre outil de devis, les informations manquantes sont signalées et une relance est préparée en l'absence de réponse.", why: "ouverture « Avec » passe-partout, problème générique, proposition à trois actions" },
  { score: 7.5, text: "Avec une liste de mobilier pour crèches à sélectionner en ligne, chaque demande de devis réunit plusieurs références à vérifier. Un devis qui part tard laisse le client attendre. / J'automatise ce type de tâche pour des PME : les références d'une demande sont relevées et un devis personnalisé est préparé pour votre validation.", why: "« Avec » répété, passif, conséquence convenue" },
  { score: 6, text: "(question courte) Qui gère les pièces administratives de vos commandes de pièces mécaniques ? / J'automatise le tri des documents des dossiers de pièces de précision.", why: "« pièces » à double sens, tournure lourde" },
];

export function buildSeniorJudgePrompt(): string {
  return `Tu es consultant B2B senior. Ce mail de prospection part sous TA signature à un dirigeant de PME française : tu ne signes que ce qui est vraiment bon.
Note sur 10. Un mail vaut 9 ou plus s'il coche TOUT :
${SENIOR_GRID.map((line, index) => `${index + 1}. ${line}`).join("\n")}
Un point raté → 8 au plus. Deux → 7 au plus. Une formulation ambiguë ou lourde → 7 au plus.
NE NOTE PAS : la salutation (posée par le programme à partir du contact réel), la présentation imposée, la ligne de démo, la demande finale, la signature, la longueur (vérifiée par un programme).

ÉTALONNAGE — mails réels, retrouve ces notes à ±0,5 :
${SENIOR_ANCHORS.map((item) => `- ${item.score} : « ${item.text} » (${item.why})`).join("\n")}

Réponds UNIQUEMENT en JSON : {"score":0-10,"reasons":["le point qui t'empêche de signer…"],"fix":"consigne de réécriture précise, ou null si 9 ou plus"}`;
}

export function parseSeniorVerdict(raw: string): JudgeVerdict | null {
  try {
    const value = JSON.parse(raw) as { score?: unknown; reasons?: unknown; fix?: unknown };
    const score = Number(value.score);
    if (!Number.isFinite(score)) return null;
    const reasons = Array.isArray(value.reasons) ? value.reasons.filter((line): line is string => typeof line === "string" && line.trim().length > 0).slice(0, 5) : [];
    const fix = typeof value.fix === "string" && value.fix.trim() ? value.fix.trim() : null;
    return { score: Math.max(0, Math.min(10, Math.round(score * 10) / 10)), criteria: {}, reasons, fix };
  } catch {
    return null;
  }
}

export async function judgeMailSenior(
  ask: AskFn,
  input: { subject: string; body: string; company: string; facts: string; contactRole?: string | null },
  operation = "qualite:juge-senior",
): Promise<JudgeVerdict | null> {
  const raw = await ask(
    "judge",
    buildSeniorJudgePrompt(),
    `Entreprise : ${input.company}\nDestinataire : ${input.contactRole?.trim() || "rôle inconnu"}\nCe que l'on sait d'elle :\n${input.facts}\n\nMAIL À SIGNER\nObjet : ${input.subject}\n\n${input.body}`,
    0,
    operation,
  ).catch(() => "");
  return parseSeniorVerdict(raw);
}

/** Les deux verdicts réunis : note la plus basse, critiques additionnées ; un verdict manquant → aucun. */
export function combineJudges(first: JudgeVerdict | null, second: JudgeVerdict | null): JudgeVerdict | null {
  if (!first || !second) return null;
  return {
    score: Math.min(first.score, second.score),
    criteria: first.criteria,
    reasons: [...(first.score < PASS_SCORE ? first.reasons : []), ...(second.score < PASS_SCORE ? second.reasons.map((line) => `Relecteur senior : ${line}`) : [])].slice(0, 6),
    fix: [first.score < PASS_SCORE ? first.fix : null, second.score < PASS_SCORE && second.fix ? `Relecteur senior : ${second.fix}` : null].filter(Boolean).join(" ") || null,
  };
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
