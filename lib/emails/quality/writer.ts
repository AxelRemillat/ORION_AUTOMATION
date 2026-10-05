import type { DerivedFact } from "@/lib/emails/derived-facts";
import type { StrategyBrief } from "@/lib/emails/strategist";
import { FORBIDDEN_WORDS, LIMITS } from "./rules";
import { COWORK_REFERENCES, TARGET_EXAMPLE } from "./references";
import type { DemoLink } from "./demo-links";
import type { MailParts } from "./template";
import { subjectInstruction, type SubjectArm } from "./experiment";
import { F2_INTRO, F3_CTA, F4_WHO, FAMILY_LIMITS, PROOF_PREFIXES, type MailFamily } from "./families";

/**
 * RÉDACTEUR du gabarit qualité. Il n'écrit que TROIS morceaux : l'objet,
 * l'accroche et la proposition. Le reste (salutation, preuve avec lien,
 * demande) est posé par le code — c'est là que les brouillons du 03/10 se
 * trompaient, et c'est ce qu'un modèle n'a aucune raison de réinventer.
 *
 * Itération 1 avec Cowork (04/10) : l'accroche part d'un FAIT PROPRE fourni
 * (jamais du secteur), la conséquence est observable, aucune hypothèse
 * visible, un seul cliché de fin et pas celui des autres mails du jour.
 */

export interface WriterInput {
  brief: StrategyBrief;
  facts: DerivedFact[];
  /** Faits propres (site, profil, article) : l'accroche part de l'un d'eux. */
  own: DerivedFact[];
  /** Ce que fait l'entreprise, lu sur son site (profil métier). */
  activity: string | null;
  companyName: string;
  demo: DemoLink;
  greeting: string;
  cta: string;
  /** Clichés de fin déjà servis aujourd'hui (« sans ressaisie »…). */
  usedCliches?: readonly string[];
  /** Quota d'ouvertures « Avec… » atteint pour la journée (1 mail sur 3). */
  avoidAvec?: boolean;
  /** Expérience n° 1 : style d'objet imposé (lib/emails/quality/experiment.ts). */
  subjectArm?: SubjectArm;
  /** Consignes de réécriture (validateur, puis juge). */
  feedback?: string | null;
  /** Famille du mail (expérience n° 2) : F1 par défaut. */
  family?: MailFamily;
  /** Secteur (libellé), pour F2 et F4 quand le profil est mince. */
  sector?: string | null;
}

const factLines = (facts: DerivedFact[]) =>
  facts
    .filter((fact) => fact.bodyUsable)
    .map((fact) => `- ${fact.label} : ${fact.value}${fact.reading ? ` (lecture : ${fact.reading})` : ""}`)
    .join("\n");

export function buildWriterPrompt(input: WriterInput): string {
  if (input.family && input.family !== "F1") return buildFamilyPrompt(input, input.family);
  const { brief } = input;
  const own = factLines(input.own);
  const other = factLines(input.facts.filter((fact) => !input.own.includes(fact)));
  const references = COWORK_REFERENCES.map((mail) => `[${mail.company}]\n${mail.body}`).join("\n\n");
  return `Tu écris, à la place d'Axel Remillat (indépendant, automatisation et IA pour PME), TROIS morceaux d'un mail de prospection à froid pour ${input.companyName}. Le reste du mail est déjà écrit par le code.

LE MAIL FINAL AURA EXACTEMENT CETTE FORME :
${input.greeting}

<ACCROCHE — c'est toi>

<PROPOSITION — c'est toi>

Exemple testable en une minute : <lien vers la démo « ${input.demo.label} »>

${input.cta}

FAITS PROPRES À ${input.companyName.toUpperCase()} — l'accroche part de L'UN D'EUX :
${own || "- (aucun)"}
${input.activity ? `- Activité (leur site) : ${input.activity}\n` : ""}
AUTRES ÉLÉMENTS (contexte seulement, jamais l'accroche) :
${other || "- (rien de plus)"}
- Tâche qui leur coûte : ${brief.pain.task}
- Ce qu'on automatiserait : ${brief.pain.automationIdea}

1. ACCROCHE — ${LIMITS.hookSentences} phrases au plus, ${LIMITS.sentenceWords} mots au plus CHACUNE.
   Phrase 1 : un FAIT PROPRE ci-dessus (nombre de sites ou de fournils, gamme précise, type de clients, zone, produit phare),
   posé comme CONTEXTE de la tâche : « Avec un catalogue qui mêle X et Y, chaque commande… », « Avec quatre fournils et des clients en restauration, … ».
   Phrase 2 : la conséquence OBSERVABLE — un client qui attend, une livraison en retard, une double saisie, une relance oubliée, un devis qui part tard.
${input.avoidAvec ? "   N'OUVRE PAS par « Avec » (déjà un mail sur trois aujourd'hui) : « Chez … », « Entre … et … », « Quand … », ou le fait en sujet (« Vos quatre fournils livrent … »).\n" : ""}   OUVERTURES INTERDITES : « Dans le/la <secteur> », « <Nom> travaille dans / est spécialisé dans / vend / fabrique », « Vous vendez / fabriquez / êtes ».
   CONSÉQUENCES INTERDITES : « prend du temps », « peut prendre du temps », « est chronophage », « demande de l'énergie ».
   INTERDIT AUSSI : l'offre d'emploi ou « vous recrutez » ; une donnée de registre (effectif, chiffre d'affaires, date de création) ;
   « sur votre site » ; le point-virgule ; toute hypothèse visible (« si vos demandes… », « éventuellement »).
2. PROPOSITION — UNE phrase de ${LIMITS.proposalWords} mots au plus, qui commence par « J'automatise ce type de tâche pour des PME : ».
   Ce qui se fait tout seul chez eux (une ou deux actions concrètes), et ce que ça change (ce qui est signalé, ce qui part tout de suite, ce que le client reçoit).
   AU PLUS UN cliché du type « sans ressaisie » / « sans oubli »${input.usedCliches?.length ? ` — et PAS ceux déjà employés aujourd'hui : ${input.usedCliches.join(", ")}` : ""}. Le plus souvent, aucun.
   Pas d'étapes techniques, pas de liste, pas d'hypothèse. Elle décrit CE QUE MONTRE la démo « ${input.demo.label} » :
   le lien posé ensuite doit illustrer exactement cette phrase (devis → préparer le devis ; tri, aiguillage, commandes → les e-mails reçus).
3. ${subjectInstruction(input.subjectArm ?? "metier")}

MOTS INTERDITS : ${FORBIDDEN_WORDS.join(", ")}, et tout sigle qu'ils n'emploient pas eux-mêmes. Aucune URL, aucune question, aucun chiffre absent des faits, pas de salutation ni de signature.
Le mail complet doit faire 60 à 90 mots : ton accroche + ta proposition ≈ 45 à 60 mots.

EXEMPLES 10/10 (d'autres entreprises — n'en reprends aucune phrase) :
${references}

${TARGET_EXAMPLE}
${brief.avoid.length ? `\nÀ NE PAS DIRE :\n${brief.avoid.map((line) => `- ${line}`).join("\n")}` : ""}${input.feedback ? `\n\nRÉÉCRITURE — la version précédente avait ces défauts, corrige-les tous :\n${input.feedback}` : ""}

Réponds UNIQUEMENT en JSON : {"subject":"…","hook":"…","proposal":"…"}`;
}

/** Ce que l'on sait d'eux, pour F2 à F4 (aucun fait propre n'est exigé pour F2 et F4). */
function knownBlock(input: WriterInput): string {
  const own = factLines(input.own);
  const other = factLines(input.facts.filter((fact) => !input.own.includes(fact)));
  return [
    input.activity ? `- Activité (leur site) : ${input.activity}` : "",
    input.sector ? `- Secteur : ${input.sector}` : "",
    own,
    other,
    `- Tâche typique de ce métier : ${input.brief.pain.task}`,
    `- Ce qu'on automatiserait : ${input.brief.pain.automationIdea}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const COMMON_RULES = (input: WriterInput) => `RÈGLES COMMUNES :
- AUCUN fait inventé : n'affirme sur eux que ce qui est listé ci-dessus. Un besoin est présenté comme courant dans leur métier, jamais comme un défaut constaté chez eux.
- Jamais l'offre d'emploi ni « vous recrutez », jamais une donnée de registre (effectif, chiffre d'affaires), jamais « sur votre site ».
- Pas d'hypothèse visible (« si vos… », « peut-être », « éventuellement »), pas de jargon ni de sigle qu'ils n'emploient pas.
- MOTS INTERDITS : ${FORBIDDEN_WORDS.join(", ")}.
- Aucune URL, aucune salutation, aucune signature, aucun chiffre absent des faits.
${input.brief.avoid.length ? `- À NE PAS DIRE : ${input.brief.avoid.join(" ; ")}\n` : ""}`;

/** Consignes de F2 (présentation directe), F3 (question courte) et F4 (démo d'abord). */
function buildFamilyPrompt(input: WriterInput, family: Exclude<MailFamily, "F1">): string {
  const { min, max } = FAMILY_LIMITS[family];
  const proof = `${PROOF_PREFIXES[family]} <lien vers la démo « ${input.demo.label} »>`;
  const shape =
    family === "F2"
      ? `${input.greeting}\n\n${F2_INTRO}\n\n<BESOIN — c'est toi>\n\n<PROPOSITION — c'est toi>\n\n${proof}\n\n${input.cta}`
      : family === "F3"
        ? `${input.greeting}\n\n<QUESTION — c'est toi>\n\n<CE QUE JE FAIS — c'est toi>\n\n${proof}\n\n${F3_CTA}`
        : `${input.greeting}\n\n${proof}\n\n<CE QUE FAIT LA DÉMO — c'est toi>\n\n${F4_WHO}\n\n${input.cta}`;
  const parts =
    family === "F2"
      ? `1. "hook" = BESOIN PROBABLE lié à leur activité, UNE ou DEUX phrases de 20 mots au plus : nomme leur activité précisément (« Pour une entreprise qui fabrique des emballages sur mesure, … ») et la tâche qui revient souvent, avec ce qu'elle produit (client qui attend, devis qui part tard, double saisie).
2. "proposal" = UNE phrase de 22 mots au plus : ce que je mettrais en place chez eux, concrètement (« Concrètement, … sont triées et … préparé pour votre validation. »). Elle décrit ce que montre la démo « ${input.demo.label} ».`
      : family === "F3"
        ? `1. "hook" = UNE QUESTION de 14 mots au plus, qui finit par « ? », sur QUI gère une tâche concrète de leur métier (« Qui s'occupe de confirmer les délais de vos commandes de pièces sur mesure ? »). Directe, polie, jamais intrusive.
2. "proposal" = UNE phrase de 18 mots au plus qui commence par « J'automatise » : ce qui se fait tout seul pour cette tâche. Elle décrit ce que montre la démo « ${input.demo.label} ».`
        : `1. "hook" = CE QUE FAIT LA DÉMO sur un cas type de LEUR métier, une ou deux phrases de 20 mots au plus : ce qui entre (une demande, une commande, une facture…) et ce qui en sort, avec leurs mots (« Elle lit une demande de devis de menuiserie et prépare le chiffrage à valider. »). Commence par « Elle » ou « On y voit ». La démo est « ${input.demo.label} ».
2. "proposal" = chaîne vide "" (la ligne « qui je suis » est posée par le code).`;
  return `Tu écris, à la place d'Axel Remillat (indépendant, automatisation et IA pour PME), des morceaux d'un mail de prospection à froid pour ${input.companyName}. Le reste est déjà écrit par le code.

LE MAIL FINAL AURA EXACTEMENT CETTE FORME :
${shape}

CE QUE L'ON SAIT D'EUX :
${knownBlock(input)}

À ÉCRIRE :
${parts}
3. ${subjectInstruction(input.subjectArm ?? (family === "F3" ? "question" : "metier"))}

${COMMON_RULES(input)}Le mail complet doit faire ${min} à ${max} mots.${input.feedback ? `\n\nRÉÉCRITURE — la version précédente avait ces défauts, corrige-les tous :\n${input.feedback}` : ""}

Réponds UNIQUEMENT en JSON : {"subject":"…","hook":"…","proposal":"…"}`;
}

export function parseParts(raw: string, family: MailFamily = "F1"): MailParts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  const text = (field: string) => (typeof value[field] === "string" ? (value[field] as string).trim() : "");
  // F4 : la ligne « qui je suis » est posée par le code, le modèle n'écrit pas de proposition.
  const parts = { subject: text("subject"), hook: text("hook"), proposal: family === "F4" ? F4_WHO : text("proposal") };
  return parts.hook && parts.proposal ? parts : null;
}
