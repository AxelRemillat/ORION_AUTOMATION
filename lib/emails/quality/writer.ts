import type { DerivedFact } from "@/lib/emails/derived-facts";
import type { StrategyBrief } from "@/lib/emails/strategist";
import { FORBIDDEN_WORDS, LIMITS } from "./rules";
import { COWORK_REFERENCES, TARGET_EXAMPLE } from "./references";
import type { DemoLink } from "./demo-links";
import type { MailParts } from "./template";
import { subjectInstruction, type SubjectArm } from "./experiment";

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
}

const factLines = (facts: DerivedFact[]) =>
  facts
    .filter((fact) => fact.bodyUsable)
    .map((fact) => `- ${fact.label} : ${fact.value}${fact.reading ? ` (lecture : ${fact.reading})` : ""}`)
    .join("\n");

export function buildWriterPrompt(input: WriterInput): string {
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

export function parseParts(raw: string): MailParts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  const text = (field: string) => (typeof value[field] === "string" ? (value[field] as string).trim() : "");
  const parts = { subject: text("subject"), hook: text("hook"), proposal: text("proposal") };
  return parts.hook && parts.proposal ? parts : null;
}
