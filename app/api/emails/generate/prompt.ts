import {
  chooseProof,
  entryOfferLabel,
  promiseLines,
  signatureFor,
} from "@/lib/offer/model";
import type { UserOffer } from "@/types";
import { toneInstruction, type ToneKey } from "@/lib/tones";
import { greetingName } from "@/lib/emails/validate";
import { addresseeOf, civilityFor, salutationFor, usagePerson } from "@/lib/emails/salutation";
import { buildFacts, factsBlock, type DerivedFact } from "@/lib/emails/derived-facts";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import type { Prospect } from "@/types";
import { briefFacts, proofById, type StrategyBrief } from "@/lib/emails/strategist";

/**
 * ÉTAPE 3 — le RÉDACTEUR, à partir du brief du stratège.
 *
 * Il reçoit UNIQUEMENT : le brief, les faits que le brief référence, le
 * persona (voix + preuve choisie par le stratège), le ton et les règles de
 * rédaction. Le code fixe en plus la salutation (un contact connu à 99 % doit
 * être nommé) et le plan (sinon tous les mails ont le même squelette). Le
 * modèle met en mots ; il ne choisit ni l'angle, ni la preuve, ni la structure.
 */

/**
 * Trois exemples, trois secteurs, trois plans. Entreprises FICTIVES, et dites
 * comme telles : aucun prospect réel ne doit servir de moule, sinon le modèle
 * apprend par cœur un mail du portefeuille et le resservira.
 */
const VOICE_EXAMPLES = [
  `[EXEMPLE FICTIF — cabinet comptable]
Objet : Pièces clients et relances

Bonjour Madame Roux,

Un cabinet de 12 personnes qui suit 300 dossiers, ça veut dire que la collecte des pièces occupe quelqu'un presque à plein temps en fin de trimestre.

Je construis des automatisations IA. Sur ce cas précis, ça ressemble à : relance des clients qui n'ont pas déposé, tri des pièces reçues, classement direct dans le bon dossier.

C'est encore fait à la main chez vous ?

Axel`,

  `[EXEMPLE FICTIF — e-commerce]
Objet : Commandes et service après-vente

Bonjour,

Combien de mails de suivi de commande votre équipe traite-t-elle un jour de forte activité ?

Si je lis bien votre catalogue, vous vendez en direct et vous assumez donc le SAV de bout en bout. Je suis à mon compte et j'automatise ce type de flux : réponse aux questions de suivi, détection des commandes bloquées, escalade seulement quand c'est nécessaire.

C'est un sujet chez vous en ce moment, ou c'est déjà outillé ?

Axel`,

  `[EXEMPLE FICTIF — BTP]
Objet : Pointages et situations de travaux

Bonjour Monsieur Ferrand,

Vous avez annoncé l'ouverture d'une seconde agence en mars. Sur des travaux, une croissance comme celle-là fait généralement doubler les pointages de chantier à consolider chaque mois, avant même que l'administratif suive.

Je travaille en indépendant sur l'automatisation de tâches répétitives. Ici, ça voudrait dire brancher les saisies terrain sur votre outil de facturation, pour que les situations sortent sans ressaisie.

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

const strip = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");

/**
 * L'adresse trouvee appartient-elle au dirigeant connu du registre ?
 *
 * On ne se contente pas de « un dirigeant existe » : le mail part a une
 * adresse precise, et nommer Monsieur Dupont dans un message adresse a
 * contact@ est une faute qui se voit tout de suite. On exige donc que le nom
 * de famille apparaisse dans la partie locale de l'adresse.
 */
export function emailBelongsTo(email: string | null | undefined, person: string | null): boolean {
  if (!email || !person) return false;
  const local = strip(email.split("@")[0] ?? "");
  /*
   * N'IMPORTE LEQUEL de ses noms suffit.
   *
   * On ne comparait que le nom de famille : `fabien@selectionhabitat.com`, dont
   * Hunter dit qu'elle appartient à Fabien Sirven, n'était donc rattachée à
   * personne, et le mail saluait le gérant du registre — quelqu'un d'autre que
   * son lecteur. Une adresse au prénom est courante dans les PME.
   */
  return person
    .trim()
    .split(/\s+/)
    .map(strip)
    .some((part) => part.length > 2 && local.includes(part));
}

/**
 * Salutation imposée : un contact identifié à haute confiance doit être nommé.
 *
 * Deux sources, dans cet ordre. Le dirigeant du registre passe en premier
 * quand l'adresse est bien la sienne : c'est la donnée la plus sûre qu'on ait,
 * et elle justifie le « Monsieur » formel quel que soit le registre.
 */
/**
 * Prenom et nom d'une personne, quel que soit le nombre de prenoms.
 *
 * L'ancien code prenait « tout sauf le premier mot » comme nom de famille :
 * « Victor Grynbaum » devenait donc « Monsieur Victor Grynbaum ». Le nom est
 * le DERNIER mot, le prenom usuel est le PREMIER.
 */
export function splitPerson(fullName: string): { first: string; last: string } | null {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

/**
 * Salutation — « Bonjour Monsieur <nom d'usage>, » des que le dirigeant est connu.
 *
 * Regle des mails ecrits a la main : on nomme le dirigeant MEME si l'adresse
 * est generique (contact@) — il la lit ou la fait suivre. Le registre ne
 * change plus la forme : « Monsieur/Madame + nom » dans tous les tons.
 *
 * Qui nommer, dans cet ordre :
 * 1. le dirigeant explicitement vise (arrivee recente) ;
 * 2. la personne dont l'adresse est nominative (Hunter >= 80, adresse a son
 *    nom) quand ce n'est pas le dirigeant : le mail arrive chez ELLE ;
 * 3. le dirigeant du registre ;
 * 4. le contact Hunter a haute confiance.
 * Sinon « Bonjour, ». Civilite inconnue → « Bonjour Prenom Nom, » (lib/emails/salutation).
 */
export function buildGreeting(
  _tone: ToneKey,
  contact?: DecisionMakerContact | null,
  leaderPerson?: string | null,
  addressee?: string | null,
): string {
  const hunter = greetingName(contact) ? contact?.full_name ?? null : null;
  const hunterInbox = hunter && emailBelongsTo(contact?.email, hunter) ? hunter : null;
  // Meme nom de famille ne veut pas dire meme personne (entreprise familiale) :
  // on compare les prenoms.
  const sameAsLeader = (name: string) =>
    Boolean(leaderPerson) && strip(splitPerson(name)?.first ?? "") === strip(splitPerson(leaderPerson ?? "")?.first ?? "");
  const otherThanLeader = hunterInbox && !sameAsLeader(hunterInbox);
  const person = addressee ?? (otherThanLeader ? hunterInbox : null) ?? null;
  if (person) return salutationFor(person);

  /*
   * LE LECTEUR D'ABORD. Le mail arrive dans une boîte : c'est son titulaire
   * qu'on salue. Sur BRIOL DIFFUSION, l'adresse retenue était `j.benes@` et le
   * mail ouvrait sur « Bonjour Monsieur Briol » — le juge l'a relevé.
   *
   * Une adresse nominative dont on ne tire pas de civilité donne « Bonjour, » :
   * une initiale ne dit pas le genre, et se tromper est pire que rester neutre.
   * Une adresse de SERVICE, elle, ne désigne personne : on nomme le dirigeant.
   */
  const owner = addresseeOf(contact?.email);
  if (owner) {
    // L'adresse est celle d'une personne qu'on connaît par ailleurs (dirigeant
    // du registre, contact Hunter) : c'est son nom COMPLET qu'on prend, lui seul
    // donne le prénom, donc la civilité. « b.dumont@ » ne dit pas « Benjamin ».
    const known = [leaderPerson, hunter].find((name) => {
      const person = name ? usagePerson(name) : null;
      return person && strip(person.last) === strip(owner.last);
    });
    if (known) return salutationFor(known);

    const civility = owner.first ? civilityFor(owner.first) : null;
    return civility ? `Bonjour ${civility} ${owner.last},` : "Bonjour,";
  }
  return salutationFor(leaderPerson ?? hunter);
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
  /** Le brief du stratège : SEULE source de ce que dit le mail. */
  brief: StrategyBrief;
  /**
   * Faits du prospect. Le prompt n'en garde QUE ceux que le brief référence :
   * le rédacteur n'a pas accès au reste (test de non-régression dédié).
   */
  facts: DerivedFact[];
  contact?: DecisionMakerContact | null;
  prospectId: string;
  /** Ouvertures et fins des derniers mails : interdiction de les reprendre. */
  avoid: string[];
  /** Dirigeant personne physique issu du registre, quand il est connu. */
  leaderPerson?: string | null;
  /** Dirigeant entrant a qui le mail s'adresse nominativement. */
  addressee?: string | null;
  /** Secteur du prospect : oriente le choix de la preuve. */
  sector?: string | null;
  /** Ce qu'Axel vend et comment il signe (page /offre). */
  offer: UserOffer;
  /** Retour du juge, lors de l'unique réécriture. */
  critique?: string;
}

/** Le plan retenu, exposé pour que la route puisse vérifier qu'il a été suivi. */
/**
 * Plan retenu pour ce mail.
 *
 * Le plan B ouvre sur une question. Or un mail ne porte qu'UNE question, et
 * c'est le CTA : quand le stratege a ecrit un CTA interrogatif, le plan B
 * demanderait donc deux questions. Le modele tranchait alors tout seul — et le
 * validateur rejetait. On derive le plan du CTA plutot que de l'imposer
 * contre lui.
 */
export function planFor(input: Pick<WritingInput, "brief" | "prospectId" | "tone">): PlanKey {
  const hasSignal = input.brief.angle.type === "recrutement" || input.brief.angle.type === "signal";
  const plan = choosePlan(input.prospectId, input.tone, hasSignal);
  const ctaIsQuestion = input.brief.cta.trim().endsWith("?");
  return plan === "B" && ctaIsQuestion ? "A" : plan;
}

const factLines = (facts: DerivedFact[]): string =>
  facts
    .map(
      (fact) =>
        `[${fact.id}] ${fact.label} : ${fact.value}` +
        `${fact.bodyUsable ? "" : "  << NE PAS ECRIRE CETTE VALEUR TELLE QUELLE >>"}` +
        `${fact.reading ? ` — lecture du poste : ${fact.reading}` : ""}`,
    )
    .join("\n");

export function buildWritingPrompt(input: WritingInput): string {
  const { brief, tone, avoid, offer } = input;
  const facts = briefFacts(brief, input.facts);
  const greeting = buildGreeting(tone, input.contact, input.leaderPerson, input.addressee);
  const hookFacts = facts.filter((fact) => brief.angle.hookFactIds.includes(fact.id));
  const whyFacts = facts.filter((fact) => brief.pain.whyThem.includes(fact.id));

  // La preuve vient de /offre et se choisit par recoupement avec le pain. Le
  // modele ne la choisit pas : une preuve hors sujet dessert plus qu'elle ne
  // sert, et il n'a aucun moyen de juger la pertinence d'une reference.
  const choice = chooseProof(offer, `${brief.pain.task} ${brief.pain.automationIdea}`, {
    sector: input.sector,
  });
  const proofLine = choice.sentence && !choice.proof
    ? `PREUVE — aucune demo ne correspond a CE pain. Dis seulement que tu as ${choice.sentence}
  (« …, avec des exemples testables sur mon site »). N'invente AUCUNE demo, n'en
  nomme aucune : une demo hors sujet (des comptes rendus RH pour une boulangerie)
  coule le mail.`
    : choice.sentence
    ? `PREUVE A MOBILISER — une seule, jamais deux. Son contenu : ${choice.sentence}
  Dis-la avec TES mots, en une clause courte. NE LA RECOPIE PAS mot pour mot et
  ne la mets pas entre guillemets : une phrase citee au milieu d'un mail sonne
  comme une plaquette. Ce qui ne doit pas changer : ce que tu as construit, et ce
  que ca fait.` +
      (choice.demo ? "\n  C'est une demo NOMMEE : dis laquelle, c'est ce qui la rend verifiable." : "")
    : "AUCUNE PREUVE ne recoupe ce pain : n'en cite aucune. Decris ce que tu construis, au present.";

  const promise = promiseLines(offer);
  const entry = entryOfferLabel(offer);

  // Les consignes du brief sont desormais VERIFIEES par du code apres
  // generation : autant le dire au redacteur, il les traite mieux quand il
  // sait qu'elles ne sont pas de simples recommandations.
  const avoidBlock = [...brief.avoid, ...avoid].length
    ? `A NE PAS DIRE / NE PAS REPRENDRE — chaque ligne est verifiee, une phrase
qui la contredit fait refuser le mail. Si tu n'es pas sur d'un fait, pose-le en
hypothese (« si… ») ou n'en parle pas :
${[...brief.avoid.map((line) => `- ${line}`), ...avoid.map((line) => `- ouverture ou fin deja servie : ${line}`)].join("\n")}`
    : "";

  const critiqueBlock = input.critique
    ? `REECRITURE DEMANDEE. Voici ce qui n'allait pas dans ta version precedente.
Corrige precisement ces points, ne repars pas de zero :
${input.critique}`
    : "";

  return `Tu ecris un email de prospection a froid A LA PLACE d'${offer.full_name ?? "Axel Remillat"}.
Tu es lui.

QUI TU ES — repris de sa page « Mon offre », a ne pas reinventer
- ${offer.full_name ?? "Axel Remillat"}, ${offer.title ?? "freelance"}.
- Ce que tu proposes en premier contact : ${entry ?? "un echange court"}.
  ${offer.entry_pitch ? `Formulation de reference : « ${offer.entry_pitch} »` : ""}
${promise.length ? `- Ce que tu peux promettre : ${promise.join(" ; ")}.` : ""}
- Ne mentionne JAMAIS un employeur, une alternance, des cours ou un stage.
- Aucun chiffre qui ne soit pas verifiable publiquement.
- Aucune URL dans le corps : « testable sur mon site » suffit, le lien est
  dans la signature.

LE BRIEF — decide par le stratege. Tu le mets en mots, tu ne le changes pas.
- ANGLE (${brief.angle.type}) : ${brief.angle.insight}
  Faits d'accroche : ${hookFacts.map((fact) => fact.id).join(", ") || "aucun"}
- PAIN : ${brief.pain.task}
  Pourquoi chez eux : ${whyFacts.map((fact) => fact.id).join(", ") || "aucun"}
  Flux a decrire : ${brief.pain.automationIdea}

FAITS AUTORISES — les seuls sur lesquels tu peux t'appuyer :
${factLines(facts) || "aucun"}

STRUCTURE — QUATRE blocs, dans cet ordre, un paragraphe chacun.
BUDGET DE MOTS PAR BLOC, a respecter : 28 / 22 / 30 / 18. Un budget par bloc
tient la longueur bien mieux qu'un total : c'est toujours le bloc 3 qui deborde.
1. ACCROCHE : UN SEUL fait concret propre a CETTE entreprise, dans une phrase
   simple centree sur elle, suivi de ce qu'il implique pour le pain. Elle doit
   echouer au TEST DE SUBSTITUTION : si la phrase reste vraie en remplaçant le
   nom par un concurrent du meme code NAF, elle est refusee.
   - Un fait STRUCTUREL est une tres bonne accroche : « Avec trois showrooms et
     une douzaine de commerciaux, chaque demande de devis doit être triée… »,
     « Avec un laboratoire qui alimente toutes vos boutiques, … ».
   - Une offre d'emploi est un INDICE du pain, JAMAIS le sujet du mail : une
     accroche qui commence par « Vous recrutez… » est refusee par du code.
     Pars de leur metier (implantations, clientele, arrivee des demandes).
   - Un fait de plus de douze mois n'est JAMAIS « recent » : ni « recemment »,
     ni « vient de », ni « nouvelle agence ».
   - Pas de commentaire du fait : « rappelle l'importance de », « souligne »,
     « temoigne de » sont refuses par du code. Dis le fait, c'est tout.
   QUATRE OUVERTURES INTERDITES, verifiees par du code :
   - « Dans le/la <secteur> » : c'est le contraire d'une accroche ;
   - « Sur votre site, on lit que… », « d'apres votre site » : citer le site
     comme source prouve qu'on les a lus, ca ne leur apprend rien. Dis le FAIT,
     pas l'endroit ou tu l'as trouve ;
   - un evenement affirme SANS DATE (« votre agence a ouvert », « vous venez
     d'inaugurer ») : donne le mois ou l'annee, sinon ne l'affirme pas ;
   - la paraphrase de leur propre page : ils la connaissent. Le fait de site
     sert a dire ce qu'il IMPLIQUE, jamais a le leur relire.
2. QUI + PREUVE : « Je suis ${offer.full_name ?? "Axel Remillat"}, » suivi de ton
   titre reformule naturellement (« je construis des automatisations et agents
   IA pour PME »), puis la preuve ci-dessous. Dis ce que tu CONSTRUIS, jamais qui tu aides : « j'aide les PME »
   ou « j'accompagne des entreprises » revendique une clientele que les preuves
   ne permettent pas d'affirmer.
3. OFFRE POUR EUX : le flux applique a LEUR cas — ce qui declenche, ce qui est
   lu, ce qui est ecrit, dans quel outil. Nomme TROIS etapes au plus : la
   quatrieme n'apprend rien et coute dix mots. UNE seule phrase, puis la
   promesse en UNE clause courte : le delai SEUL. « Sans changer d'outil » et
   la validation humaine sont vraies mais couteuses ; elles se disent a l'oral.
   Ce bloc est celui qui fait deborder le mail : 30 mots, pas un de plus.
4. DEMANDE FACILE : ton offre d'entree, formulee en question FERMEE a laquelle
   on repond oui ou non (« Est-ce que ca vous parlerait ? »).

REGLES DURES — chacune est verifiee par du code apres generation
1. SALUTATION, exactement : « ${greeting} » Rien d'autre.
2. LONGUEUR — la contrainte la plus souvent ratee. EXACTEMENT QUATRE
   paragraphes, separes par une ligne vide, un par bloc. Vise 95 mots,
   signature non comprise ; 110 est un PLAFOND STRICT. Deux phrases au plus par
   paragraphe. Compte tes mots avant de repondre : au-dela de 110, le mail est
   refuse par du code, sans discussion, et ne peut pas etre valide.
3. UNE SEULE question dans tout le mail : celle du bloc 4.
4. Aucun chiffre absent des faits autorises. Les arrondis sont permis.
5. Rien qu'on ne puisse tenir : pas de « garantir », pas de « sans
   interruption ».
6. L'offre est un FLUX branche sur leurs outils. Interdits : « logiciel »,
   « progiciel », « solution », « systeme de gestion integre », « plateforme ».
7. NOM DE L'ENTREPRISE : s'il apparait, il s'ecrit EXACTEMENT
   « ${brief.companyName} ».
8. UNE SEULE formule d'hypothese dans tout le mail.
9. Tournures INTERDITES, mot pour mot : « Mon metier, c'est de », « peut
   demander de », « m'a interesse », « j'ai ete impressionne », « dans votre
   secteur ».
10. N'ECRIS PAS la signature : elle est ajoutee par le code.

${proofLine}

OBJET
2 a 6 mots, court et SPECIFIQUE, majuscule initiale puis minuscules sauf noms
propres, dans le vocabulaire metier du pain. Exemples : « Demandes de devis chez
Menuiserie Briol », « Commandes des boutiques vers le laboratoire ». Le nom
commercial est permis (« chez ${brief.companyName} ») ; la raison sociale avec
sa forme juridique (SARL, SAS…) ne l'est pas.
INTERDIT : commencer par « Automatisation de », les mots en capitales, les
emojis, les points d'exclamation.

REGISTRE
${toneInstruction(tone)}

${avoidBlock}

${critiqueBlock}

TROIS EXEMPLES — entreprises FICTIVES, structure en quatre blocs. Ce sont des
exemples de TON et de FORME. N'en reutilise aucune phrase.
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
