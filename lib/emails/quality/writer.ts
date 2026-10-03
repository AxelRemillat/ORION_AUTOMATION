import type { DerivedFact } from "@/lib/emails/derived-facts";
import type { StrategyBrief } from "@/lib/emails/strategist";
import { FORBIDDEN_WORDS, LIMITS } from "./rules";
import { TARGET_EXAMPLE } from "./references";
import type { DemoLink } from "./demo-links";
import type { MailParts } from "./template";

/**
 * RÉDACTEUR du gabarit qualité. Il n'écrit que TROIS morceaux : l'objet,
 * l'accroche et la proposition. Le reste (salutation, preuve avec lien,
 * demande) est posé par le code — c'est là que les brouillons du 03/10 se
 * trompaient, et c'est ce qu'un modèle n'a aucune raison de réinventer.
 */

export interface WriterInput {
  brief: StrategyBrief;
  facts: DerivedFact[];
  /** Ce que fait l'entreprise, lu sur son site (profil métier). */
  activity: string | null;
  companyName: string;
  demo: DemoLink;
  greeting: string;
  cta: string;
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
  return `Tu écris, à la place d'Axel Remillat (indépendant, automatisation et IA pour PME), TROIS morceaux d'un mail de prospection à froid pour ${input.companyName}. Le reste du mail est déjà écrit par le code.

LE MAIL FINAL AURA EXACTEMENT CETTE FORME :
${input.greeting}

<ACCROCHE — c'est toi>

<PROPOSITION — c'est toi>

Exemple testable en une minute : <lien vers la démo « ${input.demo.label} »>

${input.cta}

CE QUE L'ON SAIT DE ${input.companyName.toUpperCase()}
${input.activity ? `- Activité (leur site) : ${input.activity}\n` : ""}${factLines(input.facts) || "- (rien de plus)"}
- Angle retenu par l'analyse : ${brief.angle.insight}
- Tâche qui leur coûte du temps : ${brief.pain.task}
- Ce qu'on automatiserait : ${brief.pain.automationIdea}

1. ACCROCHE — ${LIMITS.hookSentences} phrases au plus, ${LIMITS.sentenceWords} mots au plus CHACUNE.
   Phrase 1 : UN fait concret propre à eux, tiré de leur activité (sites, produits, clientèle, façon dont arrivent commandes et demandes).
   Phrase 2 : la conséquence opérationnelle, là où le temps ou les erreurs se perdent.
   INTERDIT : citer une offre d'emploi ou dire « vous recrutez » ; une donnée de registre (effectif, chiffre d'affaires, date de création, capital) ;
   leur expliquer leur propre métier ou paraphraser leur modèle (« Chez X, le détachement en temps partagé répartit… ») ;
   « sur votre site » ; le point-virgule ; les phrases à rallonge.
2. PROPOSITION — UNE phrase de ${LIMITS.proposalWords} mots au plus, qui commence par « J'automatise ce type de tâche pour des PME : ».
   Elle dit ce qui change pour EUX en mots de dirigeant : le temps gagné, les erreurs ou retards évités, ce qui se fait tout seul.
   Pas d'étapes techniques, pas de liste. Elle colle à la démo « ${input.demo.label} ».
3. OBJET — 2 à 6 mots, vocabulaire métier, majuscule initiale puis minuscules (« Commandes des restaurants »). Ni forme juridique, ni « Automatisation de ».

MOTS INTERDITS : ${FORBIDDEN_WORDS.join(", ")}, et tout sigle qu'ils n'emploient pas eux-mêmes. Aucune URL, aucune question, aucun chiffre absent des faits, pas de salutation ni de signature.
Le mail complet doit faire 60 à 90 mots : ton accroche + ta proposition ≈ 45 à 60 mots.

EXEMPLE CIBLE (9/10, une autre entreprise — n'en reprends aucune phrase) :
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
