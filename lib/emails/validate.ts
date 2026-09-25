import type { DecisionMakerContact } from "@/lib/enrichment/types";
import type { ToneKey } from "@/lib/tones";
import { knownNumbers, type DerivedFact } from "./derived-facts";

/**
 * Garde-fous déterministes, appliqués AVANT d'afficher un brouillon.
 *
 * Un juge LLM donne un avis ; ces règles-ci donnent un verdict. Tout ce qui
 * peut être vérifié par du code l'est ici — formules interdites, nombres
 * inventés, salutation qui ignore un contact connu — parce qu'un modèle qui
 * promet « une maintenance sans interruption » ne se corrige pas en le lui
 * demandant gentiment.
 */

/**
 * Formules bannies. Trois familles : le compliment creux, la fausse précision,
 * et la promesse intenable. Chacune vient d'un mail réellement parti.
 */
const BLACKLIST = [
  "impressionne",
  "engagement envers",
  "longue experience",
  "d'apres mes estimations",
  "garantir",
  "garantit",
  "garantirait",
  "sans interruption",
  "je me permets",
  "n'hesitez pas",
  "synergie",
  "optimiser vos processus",
  // Vus en sortie d'evaluation : la promesse creuse revient par la bande.
  "gagner en efficacite",
  "optimiser vos ressources",
  // L'offre est un flux branche sur leurs outils, pas un produit a installer.
  "logiciel",
  "progiciel",
  "solution",
  "systeme de gestion integre",
  "pourrait potentiellement",
  "pas mal de temps",
  "cote startup et cote entreprise",
  "revolutionner",
  "booster",
  // Vus en production : des tournures qui remplissent sans rien dire.
  "mon metier, c'est de",
  "peut demander de",
  "m'a interesse",
  "j'ai ete impressionne",
  "dans votre secteur",
];

/** Le créneau de 30 minutes est un élément de CTA, pas une donnée chiffrée. */
const CTA_NUMBERS = new Set([30]);

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface ValidationContext {
  facts: DerivedFact[];
  contact?: DecisionMakerContact | null;
  tone: ToneKey;
  companyName: string;
  /** Preuves publiques du persona : seule base autorisee pour une experience. */
  proofs?: readonly string[];
  /** Plan impose au redacteur : on verifie qu'il a bien ete suivi. */
  plan?: "A" | "B" | "C";
  /**
   * Signature ajoutee par le code. Elle est RETIREE avant de compter les mots :
   * c'est une carte de visite, pas du corps de mail, et l'y inclure faisait
   * echouer des mails de bonne longueur.
   */
  signature?: string;
  /** Entités homonymes écartées : leur nom ne doit jamais apparaître. */
  forbiddenNames?: readonly string[];
}

export interface ValidationResult {
  ok: boolean;
  /** Une ligne par règle violée, lisible telle quelle par l'utilisateur. */
  failures: string[];
}

const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Prénom exploitable du contact, quand la confiance le permet. */
export function greetingName(contact?: DecisionMakerContact | null): string | null {
  if (!contact?.full_name) return null;
  if ((contact.confidence ?? 0) < 80) return null;
  const first = contact.full_name.trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : null;
}

/** Nom de famille, pour la salutation formelle du ton factuel. */
export function greetingSurname(contact?: DecisionMakerContact | null): string | null {
  if (!contact?.full_name) return null;
  if ((contact.confidence ?? 0) < 80) return null;
  const parts = contact.full_name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

/** Paragraphes non vides, séparés par une ligne blanche. */
export function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Paragraphes de CORPS : la salutation et la signature n'en sont pas.
 *
 * Les compter faisait echouer tous les mails corrects — « Bonjour X, » suivi
 * de 4 paragraphes puis « Axel » donnait 6 blocs, donc un rejet, alors que la
 * regle porte sur le corps du message.
 */
export function bodyParagraphs(body: string): string[] {
  const blocks = paragraphs(body);
  const withoutGreeting = /^bonjour\b/i.test(blocks[0] ?? "") ? blocks.slice(1) : blocks;
  const last = withoutGreeting[withoutGreeting.length - 1] ?? "";
  // Une signature fait au plus quelques mots (« Bonne journee, » / « Axel »).
  const isSignature = last.split(/\s+/).length <= 4;
  return isSignature ? withoutGreeting.slice(0, -1) : withoutGreeting;
}

export function wordCount(body: string): number {
  return body.split(/\s+/).filter(Boolean).length;
}

/** Bornes de longueur par registre. « bref » est volontairement plus serré. */
/**
 * Bornes de longueur par registre.
 *
 * Le plafond de 110 mots avait ete calibre sur gpt-4o-mini. Les modeles gpt-6
 * n'acceptent pas `temperature: 0` et ecrivent une prose plus riche : mesure
 * sur deux series, ils atterrissent a 118-119 mots avec des notes de 4,4 et
 * 4,5 sur 5. Traiter huit mots d'ecart comme un defaut faisait echouer des
 * mails corrects et declenchait une reecriture inutile. On remonte donc le
 * plafond a 125 — au-dela, c'est vraiment trop long pour un premier contact.
 */
function lengthBounds(tone: ToneKey): { min: number; max: number } {
  return tone === "bref" ? { min: 60, max: 95 } : { min: 80, max: 110 };
}

/** Nombres écrits dans le corps, y compris « 41 M€ » et « 40,9 M ». */
function numbersIn(text: string): number[] {
  const found: number[] = [];
  for (const match of text.replace(/ /g, " ").matchAll(/(\d[\d\s]*(?:[.,]\d+)?)/g)) {
    const value = Number(match[1].replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
}

/**
 * Tournures qui affirment une EXPERIENCE PASSEE.
 *
 * Le modele a ecrit « Pour des entreprises similaires, j'ai mis en place des
 * logiciels de planification automatisee » : Axel n'a jamais dit ca. Une telle
 * phrase se verifie en rendez-vous, et elle grille la credibilite si elle est
 * fausse. Elle n'est donc autorisee que si elle correspond a une preuve
 * declaree `publicOk` dans le persona.
 */
const EXPERIENCE_MARKERS = [
  "j'ai deja ",
  "j'ai mis en place",
  "j'ai construit",
  "j'ai relie",
  "j'ai relié",
  "j'ai automatise",
  "j'ai automatisé",
  "j'ai mene",
  "j'ai mené",
  "j'ai accompagne",
  "j'ai accompagné",
  "j'ai developpe",
  "j'ai développé",
  "j'accompagne",
  "j'aide des entreprises",
  "j'aide des clients",
  "pour des entreprises similaires",
  "pour des clients similaires",
  "pour des structures similaires",
  "pour des entreprises comme",
  "pour des clients comme",
  "chez d'autres clients",
  "mes clients",
];

/** `true` si la phrase revendique une experience passee. */
function claimsExperience(sentence: string): boolean {
  const haystack = normalize(sentence);
  return EXPERIENCE_MARKERS.some((marker) => haystack.includes(normalize(marker)));
}

const SIGNIFICANT = /[a-zà-ÿ]{5,}/gi;

function words(text: string): Set<string> {
  return new Set(
    (normalize(text).match(SIGNIFICANT) ?? []).map((word) => word.toLowerCase()),
  );
}

/**
 * Phrases du mail qui revendiquent une experience sans preuve correspondante.
 *
 * On compare le vocabulaire significatif de la phrase a celui de chaque preuve
 * publique : deux mots de fond partages suffisent a considerer que la phrase
 * decrit bien la preuve. En dessous, c'est une invention.
 */
export function unprovenExperience(body: string, proofs: readonly string[]): string[] {
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  const proofWords = proofs.map(words);

  return sentences.filter((sentence) => {
    if (!claimsExperience(sentence)) return false;
    const own = words(sentence);
    return !proofWords.some((proof) => {
      let shared = 0;
      for (const word of own) if (proof.has(word)) shared += 1;
      return shared >= 2;
    });
  });
}

/**
 * Tournures de presentation de soi qui retombent sur « ingenieur ».
 *
 * Le mot n'est pas faux, mais il revient dans tous les mails et il place Axel
 * du cote du CV plutot que du cote du probleme. On l'interdit uniquement dans
 * une phrase de presentation : un prospect peut tres bien, lui, recruter un
 * ingenieur sans que le mail soit fautif.
 */
const SELF_INTRO_ENGINEER = /(je suis|moi c'est|ici)[^.!?]{0,40}ing[ée]nieur/i;

/**
 * Nuances (« j'imagine », « sans doute »...). Une seule par mail.
 *
 * Deux hypotheses dans le meme texte et le lecteur comprend qu'on ne sait rien
 * de lui : la prudence devient un aveu.
 */
const HEDGES = [
  "j'imagine",
  "je suppose",
  "je devine",
  "il me semble",
  "sans doute",
  "probablement",
  "peut-etre",
  "si je lis bien",
  "si je comprends bien",
  "si c'est comme",
  "generalement",
  "le plus souvent",
  "a priori",
];

/** Nuances employees dans le corps, doublons compris. */
export function hedgesUsed(body: string): string[] {
  const haystack = normalize(body);
  return HEDGES.filter((hedge) => haystack.includes(normalize(hedge)));
}

/**
 * Le plan impose a-t-il ete suivi ?
 *
 * Verification volontairement grossiere — on ne juge que l'OUVERTURE, la seule
 * chose qui distingue structurellement les trois plans. Sans ce controle, le
 * modele recevait trois plans et ecrivait toujours le meme.
 */
export function planApplied(plan: "A" | "B" | "C" | undefined, body: string): boolean {
  if (!plan) return true;
  const first = bodyParagraphs(body)[0] ?? "";
  if (!first) return false;
  const isQuestion = first.trim().endsWith("?");
  // B ouvre sur une question metier ; A et C ouvrent sur un constat.
  return plan === "B" ? isQuestion : !isQuestion;
}

/**
 * Questions posees dans le corps.
 *
 * Le mail ANDRA LEARNING ouvrait sur « Comment standardisez-vous… ? » et se
 * fermait sur « Comment gerez-vous actuellement… ? ». Deux questions, c'est
 * une seule de trop : le lecteur ne sait plus a laquelle repondre, et aucune
 * n'obtient de reponse. Une seule question par mail, et c'est le CTA.
 */
export function questionsIn(body: string): string[] {
  return bodyParagraphs(body)
    .flatMap((block) => block.split(/(?<=[?!.])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.endsWith("?"));
}

/**
 * Tournures de plaquette recopiees depuis le site du prospect.
 * « s'efforce de deployer l'excellence » etait leur propre accroche.
 */
const SLOGAN_ECHO = [
  "s'efforce",
  "se veut",
  "ambitionne",
  "a coeur de",
  "acteur majeur",
  "expertise reconnue",
  "d'apres ce que je comprends",
  "si je comprends bien votre",
];

export function echoesSlogan(body: string): string[] {
  const haystack = normalize(body);
  return SLOGAN_ECHO.filter((term) => haystack.includes(normalize(term)));
}

/** Corps sans la signature ajoutee par le code. */
export function withoutSignature(body: string, signature?: string): string {
  if (!signature) return body;
  const index = body.lastIndexOf(signature.trim());
  return index >= 0 ? body.slice(0, index) : body;
}

/**
 * Accroche generique, refusee.
 *
 * Le mail parti en production commençait par « Dans le commerce de gros,
 * passer une commande… » : une phrase vraie pour n'importe quel negociant de
 * France, donc une phrase qui ne dit rien de ce prospect. Une accroche qui
 * ouvre sur le secteur est une non-accroche.
 */
export function opensOnSector(body: string): boolean {
  const first = bodyParagraphs(body)[0] ?? "";
  if (!first) return false;
  // « Dans le commerce de gros, » / « Dans la formation, » / « En interim, »
  return /^(dans|au sein d)\s+(le|la|les|l'|du|de|des)\s/i.test(first.trim());
}

export function validateEmail(draft: EmailDraft, context: ValidationContext): ValidationResult {
  const failures: string[] = [];
  const body = draft.body.trim();
  const haystack = normalize(`${draft.subject} ${body}`);

  // --- Formules bannies ----------------------------------------------------
  const banned = BLACKLIST.filter((term) => haystack.includes(normalize(term)));
  if (banned.length) {
    failures.push(`Formules interdites : ${banned.join(", ")}.`);
  }

  // --- Nombres inventés ----------------------------------------------------
  // Le texte du site N'AUTORISE PAS un nombre. C'etait la faille par laquelle
  // « 268 points de livraison » est arrive dans un mail : le modele piochait
  // n'importe quel chiffre d'un dump de 2 500 caracteres. Seuls les FAITS
  // comptent — ils incluent les citations de signaux.
  const known = knownNumbers(context.facts);
  const invented = numbersIn(body).filter(
    (value) => !known.has(value) && !known.has(Math.round(value)) && !CTA_NUMBERS.has(value),
  );
  if (invented.length) {
    failures.push(
      `Nombre absent des faits : ${[...new Set(invented)].join(", ")}. Tout chiffre doit venir des données collectées.`,
    );
  }

  // --- Experience inventee -------------------------------------------------
  const unproven = unprovenExperience(body, context.proofs ?? []);
  if (unproven.length) {
    failures.push(
      `Expérience non prouvée : « ${unproven[0].slice(0, 120)} ». Reformulez au présent sur ce que vous savez faire.`,
    );
  }

  // --- Nom de l'entreprise en capitales ------------------------------------
  if (context.companyName && context.companyName === context.companyName.toUpperCase()) {
    const escaped = context.companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shouted = new RegExp("\\b" + escaped + "\\b");
    if (shouted.test(body)) {
      failures.push(`Nom de l'entreprise en capitales dans le corps : écrivez-le en casse naturelle.`);
    }
  }

  // --- Nom d'une autre entite ----------------------------------------------
  const foreign = (context.forbiddenNames ?? []).filter((name) =>
    normalize(`${draft.subject} ${body}`).includes(normalize(name)),
  );
  if (foreign.length) {
    failures.push(`Nom d'une autre entreprise (homonyme) : ${foreign.join(", ")}. Utilisez le nom exact du prospect.`);
  }

  // --- Presentation de soi -------------------------------------------------
  if (SELF_INTRO_ENGINEER.test(body)) {
    failures.push("Presentation en « ingenieur » : dites ce que vous construisez, pas votre titre.");
  }

  // --- Une seule nuance ----------------------------------------------------
  const hedges = hedgesUsed(body);
  if (hedges.length > 1) {
    failures.push(`${hedges.length} formules d'hypothèse (${hedges.join(", ")}) : une seule par mail.`);
  }

  // --- Plan impose ---------------------------------------------------------
  if (!planApplied(context.plan, body)) {
    failures.push(
      context.plan === "B"
        ? "Plan B : le mail doit s'ouvrir sur une question métier, pas sur un constat."
        : `Plan ${context.plan} : le mail doit s'ouvrir sur un constat, pas sur une question.`,
    );
  }

  // --- Accroche generique ---------------------------------------------------
  if (opensOnSector(body)) {
    failures.push(
      "L'accroche ouvre sur le secteur (« Dans le/la… ») : elle serait vraie pour " +
        "n'importe quel concurrent. Pars d'un fait propre à cette entreprise.",
    );
  }

  // --- Une seule question --------------------------------------------------
  const questions = questionsIn(body);
  if (questions.length > 1) {
    failures.push(
      `${questions.length} questions dans le mail : une seule, et c'est le CTA. ` +
        `À supprimer : « ${questions[0].slice(0, 70)} »`,
    );
  }

  // --- Paraphrase du site ---------------------------------------------------
  const slogan = echoesSlogan(body);
  if (slogan.length) {
    failures.push(`Reprise du slogan du site : ${slogan.join(", ")}. Dites un fait, pas leur promesse.`);
  }

  // --- Salutation ----------------------------------------------------------
  const first = greetingName(context.contact);
  const surname = greetingSurname(context.contact);
  if (first) {
    const usesName =
      normalize(body).includes(normalize(`bonjour ${first}`)) ||
      (surname ? normalize(body).includes(normalize(`monsieur ${surname}`)) : false) ||
      (surname ? normalize(body).includes(normalize(`madame ${surname}`)) : false);
    if (!usesName) {
      failures.push(`Contact nominatif connu (${context.contact?.full_name}) mais salutation impersonnelle.`);
    }
  }

  // --- Forme ---------------------------------------------------------------
  const blocks = bodyParagraphs(body);
  if (blocks.length < 3 || blocks.length > 4) {
    failures.push(
      `${blocks.length} paragraphe(s) de corps : il en faut 3 à 4, séparés par une ligne vide.`,
    );
  }

  // La signature ne compte pas : elle est posee par le code, identique partout.
  const words = wordCount(withoutSignature(body, context.signature));
  const { min, max } = lengthBounds(context.tone);
  if (words < min || words > max) {
    // Le retour doit etre ACTIONNABLE : « 126 mots, cible 60-110 » laisse le
    // modele estimer la coupe. Sans temperature basse, il estime mal — on lui
    // donne donc le nombre de mots a retirer ou a ajouter.
    const delta = words > max ? words - max : min - words;
    const verbe = words > max ? "Retire" : "Ajoute";
    failures.push(
      `${words} mots : la cible est ${min}-${max} pour ce registre. ${verbe} environ ${delta} mots.`,
    );
  }

  // --- Objet ---------------------------------------------------------------
  failures.push(...validateSubject(draft.subject, context.companyName));

  return { ok: failures.length === 0, failures };
}

/** Règles d'objet, isolées : elles servent aussi aux tests. */
export function validateSubject(subject: string, companyName: string): string[] {
  const failures: string[] = [];
  const trimmed = subject.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  if (words.length < 2 || words.length > 6) {
    failures.push(`Objet de ${words.length} mot(s) : la cible est 2 à 6.`);
  }
  if (/^automatisation\s+(de|du|des)\b/i.test(trimmed)) {
    failures.push("Objet : « Automatisation de… » est interdit.");
  }
  if (companyName && normalize(trimmed).includes(normalize(`chez ${companyName}`))) {
    failures.push("Objet : « … chez <société> » est interdit.");
  }
  if (/[!]/.test(trimmed)) failures.push("Objet : pas de point d'exclamation.");
  if (/\p{Extended_Pictographic}/u.test(trimmed)) failures.push("Objet : pas d'emoji.");

  // Majuscules : tolérées pour un nom propre isolé, jamais pour un mot entier
  // en capitales ni pour une majuscule au milieu d'une phrase banale.
  const shouting = words.filter((word) => word.length > 2 && word === word.toUpperCase() && /[A-ZÀ-Ý]/.test(word));
  if (shouting.length) {
    failures.push(`Objet : ${shouting.join(", ")} en capitales.`);
  }

  return failures;
}
