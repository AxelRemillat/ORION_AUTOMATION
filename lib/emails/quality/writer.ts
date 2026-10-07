import { FACTS_MIN_DISTINCTIVENESS, type KeyFact } from "./facts-gate";
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
  /** Poste de la personne réellement contactée (contacts nominatifs, 06/10) : l'angle s'y adapte. */
  recipientRole?: string | null;
  /** `key_figures.facts` (agent1), triés du plus distinctif au moins distinctif : l'accroche s'ancre dans le meilleur (Cowork #31). */
  keyFacts?: readonly KeyFact[] | null;
}

/**
 * Faits vérifiés de la fiche (Cowork #31) : le problème naît du MEILLEUR fait
 * et de son process, comme PLIMETAL (« cotes manquantes dans vos demandes de
 * découpe laser »). Vide quand la fiche n'a pas de faits (fiches d'avant).
 */
export function keyFactsBlock(facts: readonly KeyFact[] | null | undefined): string {
  const usable = (facts ?? []).filter((fact) => fact.distinctiveness >= FACTS_MIN_DISTINCTIVENESS);
  if (!usable.length) return "";
  const lines = usable.slice(0, 5).map((fact, index) => `${index + 1}. [${fact.distinctiveness}/3] ${fact.text}${fact.process_hint ? ` — process lié : ${fact.process_hint}` : ""}`);
  return `FAITS VÉRIFIÉS DE LA FICHE (du plus distinctif au moins distinctif) — OBLIGATOIRE :
${lines.join("\n")}
Ancre le problème dans le fait n° 1 (ou un autre de cette liste) et dans SON process : le problème naît de ce process précis (PLIMETAL : « cotes manquantes dans vos demandes de découpe laser »). Ce que tu dis de l'entreprise vient de cette liste, jamais d'ailleurs.`;
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
${input.recipientRole ? `- Destinataire : ${input.recipientRole} — parle de SA fonction (DAF : factures, relances ; commercial : devis, commandes ; service client : demandes reçues)\n` : ""}${keyFactsBlock(input.keyFacts) ? `\n${keyFactsBlock(input.keyFacts)}\n` : ""}
1. ACCROCHE — ${LIMITS.hookSentences} phrases au plus, ${LIMITS.sentenceWords} mots au plus CHACUNE.
   Phrase 1 : un FAIT PROPRE ci-dessus (nombre de sites ou de fournils, gamme précise, type de clients, zone, produit phare),
   posé comme CONTEXTE de la tâche : « Avec un catalogue qui mêle X et Y, chaque commande… », « Avec quatre fournils et des clients en restauration, … ».
   Phrase 2 : la conséquence OBSERVABLE — un client qui attend, une livraison en retard, une double saisie, une relance oubliée, un devis qui part tard.
${input.avoidAvec ? "   N'OUVRE PAS par « Avec » (déjà un mail sur trois aujourd'hui) : « Chez … », « Entre … et … », « Quand … », ou le fait en sujet (« Vos quatre fournils livrent … »).\n" : ""}   OUVERTURES INTERDITES : « Dans le/la <secteur> », « <Nom> travaille dans / est spécialisé dans / vend / fabrique », « Vous vendez / fabriquez / êtes ».
   CONSÉQUENCES INTERDITES : « prend du temps », « peut prendre du temps », « est chronophage », « demande de l'énergie ».
   INTERDIT AUSSI : l'offre d'emploi ou « vous recrutez » ; une donnée de registre (effectif, chiffre d'affaires, date de création) ;
   « sur votre site » ; le point-virgule ; toute hypothèse visible (« si vos demandes… », « éventuellement »).
2. PROPOSITION — UNE phrase de ${LIMITS.proposalWords} mots au plus, À LA PREMIÈRE PERSONNE et à la VOIX ACTIVE, qui commence par « J'automatise », « Je mets en place » ou « Je construis » et nomme LA tâche de l'accroche
   (« J'automatise ce tri : chaque demande arrive directement à la bonne personne, qui répond le jour même. »). Jamais de passif (« sont triés », « est préparé »).
   Une action concrète et son RÉSULTAT visible pour eux ou leur client (ce qui arrive, ce qui est signalé, ce que le client reçoit).
   AU PLUS UN cliché du type « sans ressaisie » / « sans oubli »${input.usedCliches?.length ? ` — et PAS ceux déjà employés aujourd'hui : ${input.usedCliches.join(", ")}` : ""}. Le plus souvent, aucun.
   Pas d'étapes techniques, pas de liste, pas d'hypothèse. Elle décrit CE QUE MONTRE la démo « ${input.demo.label} » :
   le lien posé ensuite doit illustrer exactement cette phrase (devis → préparer le devis ; tri, aiguillage, commandes → les e-mails reçus).
3. ${subjectInstruction(input.subjectArm ?? "metier")}

MOTS INTERDITS : ${FORBIDDEN_WORDS.join(", ")}, et tout sigle qu'ils n'emploient pas eux-mêmes. Aucune URL, aucune question, aucun chiffre absent des faits, pas de salutation ni de signature.
Le mail complet fait 75 mots AU PLUS : ton accroche + ta proposition ≈ 35 à 45 mots. Aucune tournure lourde, aucun mot à double sens dans leur métier, aucun passif inutile.

${REVIEWER_GRID}

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
    input.recipientRole ? `- Destinataire : ${input.recipientRole} — parle de SA fonction` : "",
    keyFactsBlock(input.keyFacts),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * La GRILLE DU RELECTEUR SENIOR (Cowork, 06/10/2026), donnée au rédacteur : il
 * écrit pour être signé, pas pour passer un contrôle.
 */
const REVIEWER_GRID = `CE QUI SERA EXIGÉ PAR LE RELECTEUR (consultant B2B senior qui signe le mail) — coche TOUT :
- Le fait le plus DISTINCTIF que l'on sait d'eux (leurs produits, leur clientèle, un service précis), jamais une catégorie générique (« vos demandes de devis », « votre bureau d'étude »).
- Un problème concret, crédible, lié à CE fait : il NOMME l'élément manquant précis (une référence, une dimension, un n° de véhicule, une quantité) ET sa conséquence dans leur process — jamais « le client attend », « les devis tardent ».
- Le fait passe le test de substitution : il ne resterait pas vrai pour 10 concurrents (pas une activité, un formulaire, une page du site) ; il est cité fidèlement, sans en changer le sens.
- Ce que je fais, à la 1re personne, et le RÉSULTAT visible pour eux ou leur client (ce qui arrive, ce qui est signalé, ce que le client reçoit) — jamais « prépare un dossier / une fiche / son classement ».
- Aucun mot à double sens dans leur métier, aucune tournure lourde, phrases courtes.
- Toujours la VOIX ACTIVE : « je signale », « je prépare » — jamais « sont signalées », « est préparé ».
- Jamais deux fois le même groupe nominal (« lunettes de soleil » une seule fois) : reprends-le par « ces commandes », « ces produits ».`;

const COMMON_RULES = (input: WriterInput) => `${REVIEWER_GRID}

RÈGLES COMMUNES :
- AUCUN fait inventé : n'affirme sur eux que ce qui est listé ci-dessus ; chaque précision sur leur activité (« avions régionaux », « vêtements professionnels ») doit y figurer. Un besoin est présenté comme courant dans leur métier, jamais comme un défaut constaté chez eux.
- Jamais l'offre d'emploi ni « vous recrutez », jamais une donnée de registre (effectif, chiffre d'affaires), jamais « sur votre site ».
- Pas d'hypothèse visible (« si vos… », « peut-être », « éventuellement »), pas de jargon ni de sigle qu'ils n'emploient pas.
- MOTS INTERDITS : ${FORBIDDEN_WORDS.join(", ")}.
- Aucune URL, aucune salutation, aucune signature, aucun chiffre absent des faits.
${input.brief.avoid.length ? `- À NE PAS DIRE : ${input.brief.avoid.join(" ; ")}\n` : ""}`;

/**
 * BUDGETS DE MOTS DE F5 — explicites, donc vérifiables.
 *
 * Le code pose lui-même la salutation (3 mots), la ligne de démo (9 avec son
 * URL) et la demande (13) : 25 mots du plafond sont déjà consommés avant que
 * le modèle n'écrive quoi que ce soit. L'argumentaire doit tenir dans le reste.
 */
export const F5_FIXED_WORDS = 25;
export const F5_HOOK_WORDS = 30;
export const F5_PROPOSAL_WORDS = 20;

/** Consignes de F2 (présentation directe), F3 (question courte) et F4 (démo d'abord). */
function buildFamilyPrompt(input: WriterInput, family: Exclude<MailFamily, "F1">): string {
  const { min, max } = FAMILY_LIMITS[family];
  const proof = `${PROOF_PREFIXES[family]} <lien vers la démo « ${input.demo.label} »>`;
  const shape =
    family === "F2"
      ? `${input.greeting}\n\n${F2_INTRO}\n\n<BESOIN — c'est toi>\n\n<PROPOSITION — c'est toi>\n\n${proof}\n\n${input.cta}`
      : family === "F3"
        ? `${input.greeting}\n\n<QUESTION — c'est toi>\n\n<CE QUE JE FAIS — c'est toi>\n\n${proof}\n\n${F3_CTA}`
        // F5 « partenaire » (agent3) : même ordre que F1, contenu différent.
        : family === "F5"
          ? `${input.greeting}\n\n<FAIT SUR L'AGENCE + PROBLÈME DE SES CLIENTS — c'est toi>\n\n<PROPOSITION EN MARQUE BLANCHE — c'est toi>\n\n${proof}\n\n${input.cta}`
          : `${input.greeting}\n\n<FAIT + PROBLÈME — c'est toi>\n\n${proof}\n\n<CE QUE MONTRE LA DÉMO — c'est toi>\n\n${input.cta}`;
  const parts =
    family === "F2"
      ? `1. "hook" = BESOIN PROBABLE lié à leur activité, UNE ou DEUX phrases de 20 mots au plus : nomme leur activité précisément (« Pour une entreprise qui fabrique des emballages sur mesure, … ») et la tâche qui revient souvent, avec ce qu'elle produit (client qui attend, devis qui part tard, double saisie).
2. "proposal" = UNE phrase de 22 mots au plus, À LA PREMIÈRE PERSONNE et à la VOIX ACTIVE, qui commence par « Je mets en place », « J'automatise » ou « Je construis » : ce que je ferais chez eux, concrètement (« Je mets en place le tri de vos demandes de pièces et je prépare la commande fournisseur, que vous validez. »). Jamais de passif (« sont triées », « est préparée »). Elle décrit ce que montre la démo « ${input.demo.label} ».
   Phrases simples et naturelles : pas de tournure lourde (« revient souvent, avec une intervention qui attend »).`
      : family === "F3"
        ? `1. "hook" = UNE QUESTION de 14 mots au plus, qui finit par « ? », sur QUI gère une tâche concrète de leur métier, et qui NOMME UN OBJET CONCRET PROPRE À L'ENTREPRISE (un produit, un type de commande, un document précis : « Qui confirme les délais de vos commandes d'épandeurs ? »). Jamais un objet vague (« vos documents clients », « vos demandes »). Directe, polie, jamais intrusive.
2. "proposal" = UNE phrase de 18 mots au plus qui commence par « J'automatise », À LA VOIX ACTIVE : je fais, je signale, je prépare (« J'automatise la lecture des plans et je signale les cotes manquantes au bureau d'étude. ») — JAMAIS « sont signalées », « est préparé ». Elle décrit ce que montre la démo « ${input.demo.label} ». Ne répète pas le nom de l'objet de la question : reprends-le par « ces commandes », « ces plans ».`
        : family === "F5"
          ? `1. "hook" = LE FAIT PUIS LE PROBLÈME, deux phrases, ${F5_HOOK_WORDS} mots au plus — la salutation, la ligne de démo et la demande prennent déjà ${F5_FIXED_WORDS} mots du plafond de ${max}. Phrase 1 : un fait PRÉCIS lu sur leur site (client nommé, réalisation, offre) — jamais un compliment. Phrase 2 : ce que ce type de client leur demande ensuite et qu'une petite équipe ne peut pas produire (automatisations, agents IA, intégrations), ou la capacité qui les oblige à refuser. C'est une situation TYPE du métier d'agence, jamais un défaut affirmé chez eux.
2. "proposal" = UNE phrase de ${F5_PROPOSAL_WORDS} mots au plus, À LA PREMIÈRE PERSONNE : je réalise en MARQUE BLANCHE, ils vendent, gardent la relation et facturent (« Je les construis en marque blanche : vous vendez et gardez la relation, je livre sous votre nom. »). Jamais proposer de travailler en direct avec leurs clients. Elle décrit ce que montre la démo « ${input.demo.label} ».`
        : `1. "hook" = FAIT + PROBLÈME, comme un mail classique : DEUX phrases de 20 mots au plus. Phrase 1 : un FAIT PROPRE à l'entreprise tiré de ce que l'on sait d'elle — un produit, un client, un chiffre ou un process NOMMÉ ; JAMAIS une description du secteur (« vous assurez la maintenance de parcs informatiques » est refusé). Phrase 2 : le problème concret qui découle de CE fait (une demande qui attend, une référence manquante, un devis qui part tard) — pas un problème générique (« le client attend une réponse rapide »). JAMAIS d'ouverture par la démo (« Elle lit… », « Dans la démo… », « Une démo… » : interdits, Cowork #34).
2. "proposal" = CE QUE MONTRE LA DÉMO, HONNÊTEMENT, en preuve : la démo est GÉNÉRIQUE, elle n'a pas été faite sur leur métier ni leurs données. UNE phrase, 30 mots au plus, dont le sujet est LA DÉMO (c'est elle qui lit, pas moi) : « La démo montre une <demande d'intervention / commande / facture> type lue et <une confirmation de délai / un devis / une facture> prête à valider ; le même principe s'appliquerait à vos <ce qu'ils traitent>. » Jamais « Je lis… ». <le résultat> est UN DOCUMENT ou UNE RÉPONSE que le client reçoit (accusé de réception, confirmation de commande ou de délai, brouillon de devis, facture, réponse au client) — JAMAIS « le tri », « le classement », « les informations à valider ». La démo est « ${input.demo.label} ».`;
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
  const parts = { subject: text("subject"), hook: text("hook"), proposal: text("proposal") };
  return parts.hook && parts.proposal ? parts : null;
}
