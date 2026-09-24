import { personaBlock, pickProof, BOOKING_URL } from "@/lib/persona";
import { toneInstruction, type ToneKey } from "@/lib/tones";
import { greetingName, greetingSurname } from "@/lib/emails/validate";
import { buildFacts, factsBlock, type DerivedFact } from "@/lib/emails/derived-facts";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import type { Prospect } from "@/types";
import type { DeepAnalysis, HookCandidate, PainCandidate } from "./analysis";

/**
 * ÉTAPE 2 — la rédaction, à partir du raisonnement déjà posé.
 *
 * Trois décisions sont prises ICI, par le code, et plus laissées au modèle :
 * la salutation (un contact connu à 99 % doit être nommé), le plan du mail
 * (sinon tous les mails ont le même squelette) et la preuve mobilisée (sinon
 * c'est toujours la même phrase creuse). Le modèle met en mots ; il ne choisit
 * plus la structure.
 */

/**
 * Trois exemples, trois secteurs, trois plans. Entreprises FICTIVES, et dites
 * comme telles : aucun prospect réel ne doit servir de moule, sinon le modèle
 * apprend par cœur un mail du portefeuille et le resservira.
 */
const VOICE_EXAMPLES = [
  `[EXEMPLE FICTIF — cabinet comptable]
Objet : pièces clients et relances

Bonjour Claire,

Un cabinet de 12 personnes qui suit 300 dossiers, ça veut dire que la collecte des pièces occupe quelqu'un presque à plein temps en fin de trimestre.

Je construis des automatisations IA. Sur ce cas précis, ça ressemble à : relance des clients qui n'ont pas déposé, tri des pièces reçues, classement direct dans le bon dossier.

C'est encore fait à la main chez vous ?

Axel`,

  `[EXEMPLE FICTIF — e-commerce]
Objet : commandes et service après-vente

Bonjour,

Combien de mails de suivi de commande votre équipe traite-t-elle un jour de forte activité ?

Si je lis bien votre catalogue, vous vendez en direct et vous assumez donc le SAV de bout en bout. Je suis Axel Remillat, j'automatise ce type de flux : réponse aux questions de suivi, détection des commandes bloquées, escalade seulement quand c'est nécessaire.

C'est un sujet chez vous en ce moment, ou c'est déjà outillé ?

Axel`,

  `[EXEMPLE FICTIF — BTP]
Objet : pointages et situations de travaux

Bonjour Monsieur Ferrand,

Vous avez annoncé l'ouverture d'une seconde agence en mars. Sur des travaux, une croissance comme celle-là fait généralement doubler les pointages de chantier à consolider chaque mois, avant même que l'administratif suive.

Je suis Axel Remillat, ingénieur freelance en IA. J'ai déjà relié des saisies terrain à la facturation, pour que les situations sortent sans ressaisie.

Ça se passe comment chez vous aujourd'hui ?

Axel`,
];

/**
 * Contexte factuel d'un prospect, en faits numerotes.
 *
 * Partage avec la generation de REPONSES (app/api/emails/reply) : les deux ont
 * besoin de la meme base factuelle, et il n'y a aucune raison qu'elles
 * divergent sur ce qu'on sait d'une entreprise.
 */
export function buildContext(prospect: Prospect): string {
  return factsBlock(buildFacts(prospect).facts);
}

/** Les trois plans possibles. Le choix est déterministe, pas laissé au modèle. */
const PLANS = {
  A: `PLAN A — observation, implication, offre, question
1. L'accroche : l'observation retenue, avec sa consequence concrete.
2. Ce que ca implique dans leur quotidien, pose comme une HYPOTHESE
   ("si c'est comme chez d'autres...", "j'imagine que...").
3. Ce que tu fais, applique a CE cas : concret, pas une liste de technologies.
4. Une question ouverte.`,

  B: `PLAN B — question metier, observation, offre, question
1. L'accroche : la question metier retenue. Elle ouvre le mail, avant meme que
   tu dises qui tu es.
2. L'observation qui justifie la question.
3. Ce que tu fais, applique a CE cas. Ta presentation peut se fondre ici.
4. Une question ouverte de cloture, differente de celle d'ouverture.`,

  C: `PLAN C — signal, implication, offre, question
1. L'accroche : le signal recent, cite tel qu'il est atteste.
2. Ce que ce signal implique pour leurs process, pose comme une hypothese.
3. Ce que tu fais, applique a CE cas.
4. Une question ouverte.`,
} as const;

export type PlanKey = keyof typeof PLANS;

/**
 * Plan retenu, dérivé de l'identifiant du prospect et du registre.
 *
 * Deux prospects n'ont pas le même plan ; le même prospect garde le sien d'une
 * génération à l'autre. Le plan C n'est offert que si un signal existe
 * réellement — sinon l'accroche n'aurait rien à citer.
 */
export function choosePlan(prospectId: string, tone: ToneKey, hasSignal: boolean): PlanKey {
  let hash = 0;
  for (const char of `${prospectId}:${tone}`) hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  const options: PlanKey[] = hasSignal ? ["A", "B", "C"] : ["A", "B"];
  return options[hash % options.length];
}

/** Salutation imposée : un contact identifié à haute confiance doit être nommé. */
export function buildGreeting(tone: ToneKey, contact?: DecisionMakerContact | null): string {
  const first = greetingName(contact);
  if (!first) return "Bonjour,";
  if (tone === "factuel") {
    const surname = greetingSurname(contact);
    return surname ? `Bonjour Monsieur ${surname},` : `Bonjour ${first},`;
  }
  return `Bonjour ${first},`;
}

export interface Evidence {
  label: string;
  value: string;
  source: string;
  url?: string;
}

export interface GeneratedEmail {
  subject: string;
  body: string;
}

export interface WritingInput {
  tone: ToneKey;
  analysis: DeepAnalysis;
  facts: DerivedFact[];
  contact?: DecisionMakerContact | null;
  prospectId: string;
  companyName: string;
  /** Ouvertures et fins des derniers mails : interdiction de les reprendre. */
  avoid: string[];
  /** Retour du juge, lors de l'unique réécriture. */
  critique?: string;
}

const factLine = (facts: DerivedFact[], ids: string[]): string =>
  ids
    .map((id) => facts.find((fact) => fact.id === id))
    .filter((fact): fact is DerivedFact => Boolean(fact))
    .map((fact) => `${fact.id} = ${fact.label} : ${fact.value}`)
    .join(" ; ");

export function buildWritingPrompt(input: WritingInput): string {
  const { analysis, facts, tone, avoid } = input;
  const hook: HookCandidate =
    analysis.hookCandidates[analysis.chosen.hookIndex] ?? analysis.hookCandidates[0];
  const pain: PainCandidate =
    analysis.painCandidates[analysis.chosen.painIndex] ?? analysis.painCandidates[0];

  const hasSignal = facts.some((fact) => fact.source === "Signal web");
  const plan = choosePlan(input.prospectId, tone, hasSignal && hook.type === "signal");
  const greeting = buildGreeting(tone, input.contact);

  // Une preuve pertinente, ou aucune : pas de preuve de remplissage.
  const proof = pickProof(`${pain.task} ${pain.whyHere} ${pain.automationIdea}`);
  const proofLine = proof
    ? `PREUVE A MOBILISER, telle quelle ou presque : « ${proof.text} ». Une seule, jamais deux.`
    : `AUCUNE PREUVE PERTINENTE pour ce pain : n'en invente pas. Decris simplement ce que tu construis, au present.`;

  // Le creneau de 30 minutes et le lien sont reserves au ton factuel : ailleurs,
  // une question ouverte obtient bien plus de reponses.
  const cta =
    tone === "factuel" && BOOKING_URL
      ? `CTA : propose un creneau de 30 minutes avec ce lien, tel quel : ${BOOKING_URL}`
      : `CTA : une QUESTION OUVERTE, a laquelle on repond en une ligne (par exemple « C'est un sujet chez vous en ce moment ? »). Pas de lien, pas de creneau.`;

  const lengths = tone === "bref" ? "40 a 70 mots" : "60 a 110 mots";

  const avoidBlock = avoid.length
    ? `INTERDIT DE REUTILISER — ouvertures et fins de tes derniers mails :
${avoid.map((line) => `- ${line}`).join("\n")}`
    : "";

  const critiqueBlock = input.critique
    ? `REECRITURE DEMANDEE. Voici ce qui n'allait pas dans ta version precedente.
Corrige precisement ces points, ne repars pas de zero :
${input.critique}`
    : "";

  return `Tu ecris un email de prospection a froid A LA PLACE d'Axel. Tu es lui.

${personaBlock()}

CE QUE L'ANALYSE A ETABLI
- Leur modele economique : ${analysis.businessModel.text}
- Implications deduites :
${analysis.implications.map((item) => `  - ${item.text}  [${factLine(facts, item.factIds)}]`).join("\n")}
- ACCROCHE RETENUE (${hook.type}), c'est la PREMIERE PHRASE apres la salutation :
  ${hook.text}
  Faits qui la soutiennent : ${factLine(facts, hook.factIds)}
- PAIN RETENU : ${pain.task}
  Qui le subit : ${pain.whoSuffers}
  Pourquoi chez eux : ${pain.whyHere}  [${factLine(facts, pain.factIds)}]
  Automatisation concrete a decrire : ${pain.automationIdea}

REGLES DURES — chacune est verifiee par du code apres generation
1. SALUTATION, exactement : « ${greeting} » Rien d'autre.
2. La premiere phrase apres la salutation est l'accroche retenue, reformulee
   naturellement. JAMAIS un compliment ("impressionne", "votre engagement"),
   jamais la simple reformulation d'un fait ("fondee en 1969").
3. Le pain est pose comme une HYPOTHESE ou une QUESTION, jamais comme un constat.
4. Aucun chiffre absent des faits ci-dessus. Les arrondis sont permis :
   40 878 286 EUR peut s'ecrire « 41 M EUR ».
5. Rien qu'on ne puisse tenir : pas de « garantir », pas de « sans
   interruption », pas de « d'apres mes estimations ».
6. 3 a 4 paragraphes COURTS, separes par une LIGNE VIDE. ${lengths}.
7. Signature : « Axel » seul sur la derniere ligne.

${PLANS[plan]}

${proofLine}

${cta}

OBJET
2 a 6 mots, minuscules sauf noms propres, dans le vocabulaire metier du pain.
INTERDIT : commencer par « Automatisation de », contenir « chez ${input.companyName} »,
les majuscules de mise en avant, les emojis, les points d'exclamation.
Exemples de forme : « contrats de mission et releves d'heures »,
« alertes, interventions et pieces », « pieces clients et relances ».

REGISTRE
${toneInstruction(tone)}

${avoidBlock}

${critiqueBlock}

TROIS EXEMPLES — secteurs differents, plans differents, entreprises FICTIVES.
Ce sont des exemples de TON et de STRUCTURE. N'en reutilise aucune phrase.
${VOICE_EXAMPLES.join("\n\n")}

Reponds UNIQUEMENT avec un objet JSON :
{ "email": { "subject": "...", "body": "..." } }
Dans "body", les sauts de ligne sont de vrais retours a la ligne, et les
paragraphes sont separes par une ligne vide.`;
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value.trim() : fallback;

/** Valide la sortie de l'etape 2 ; renvoie null si elle est inexploitable. */
export function parseEmail(raw: string): GeneratedEmail | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const email = ((parsed as Record<string, unknown>).email ?? {}) as Record<string, unknown>;
  const body = asString(email.body);
  if (!body) return null;

  return { subject: asString(email.subject, "une piste d'automatisation"), body };
}
