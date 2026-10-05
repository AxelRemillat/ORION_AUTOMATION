import type { DecisionMakerContact } from "@/lib/enrichment/types";
import type { ToneKey } from "@/lib/tones";
import { knownNumbers, type DerivedFact } from "./derived-facts";
import { sentenceProblems } from "./sentences";
import { MAX_BODY_WORDS, countedText, wordCount as sharedWordCount } from "@/lib/mail-preflight/words";

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
  // Sources legales : le fait est bon, le NOM de la source ne se dit pas dans
  // un mail a froid — « vous avez ouvert une agence » et non « le BODACC
  // annonce la creation d'un etablissement ».
  "bodacc",
  "annonce legale",
  "annonces legales",
  "journal officiel",
  // « au registre » et « du registre » ne suffisaient pas : un mail est sorti
  // avec « Le registre indique que… ». Le mot lui-meme n'a aucune raison
  // d'apparaitre dans un mail a froid, quelle que soit la preposition.
  "registre",
];

/**
 * Tournures de STRUCTURE JURIDIQUE, interdites en ACCROCHE.
 *
 * « Terdici Vegetal est representee par J.DIS » ouvrait un mail en production.
 * L'actionnariat et la forme juridique servent a decider si on ecrit et a qui ;
 * ils ne disent rien du moment de l'entreprise. Ailleurs dans le mail, la
 * mention reste possible — c'est l'ouverture qui est en cause.
 */
const STRUCTURE_HOOK = [
  "representee par",
  "represente par",
  "filiale de",
  "filiale du",
  "appartient au groupe",
  "societe mere",
  "detenue par",
  "actionnaire",
];

export function opensOnStructure(body: string, signature?: string): string | null {
  const first = bodyParagraphs(body, signature)[0] ?? "";
  if (!first) return null;
  const haystack = normalize(first);
  return STRUCTURE_HOOK.find((term) => haystack.includes(normalize(term))) ?? null;
}

/**
 * FAITS BRUTS DU REGISTRE, interdits en ACCROCHE.
 *
 * Effectif, chiffre d'affaires, code NAF, capital, ancienneté : ils servent à
 * CIBLER, pas à ouvrir un mail. « Avec 20 à 49 salariés et 8 M€ de CA… » se lit
 * comme une fiche Pappers recopiée, et reste vrai pour mille entreprises. Vu sur
 * ARTFLEX (520644386) le 30/09/2026. L'accroche décrit une réalité MÉTIER
 * observée : ce que dit leur site, un signal daté, leur activité concrète.
 */
const REGISTRY_HOOK: readonly { label: string; pattern: RegExp }[] = [
  { label: "effectif", pattern: /\b\d+\s*(?:à|a|-)\s*\d+\s*salari|\b\d+\s*salari|\beffectif\b/ },
  // Le capital AVANT le chiffre d'affaires : « au capital de 50 000 € » est un montant en euros.
  { label: "capital", pattern: /capital social|au capital|capital de\s+\d/ },
  { label: "chiffre d'affaires", pattern: /chiffre d.affaires|\bca de\b|\d\s*(?:m|k)?\s*€|millions? d.euros|\bm€/ },
  { label: "code NAF", pattern: /\bnaf\b|\bcode ape\b|\bape\b/ },
  {
    label: "ancienneté",
    pattern: /(?:fond|cre)ee? en (?:19|20)\d{2}|depuis (?:19|20)\d{2}|\d+ ans d.(?:existence|activite|anciennete)|immatricul/,
  },
];

export function opensOnRegistryFact(body: string, signature?: string): string | null {
  const first = bodyParagraphs(body, signature)[0] ?? "";
  if (!first) return null;
  const haystack = normalize(first);
  return REGISTRY_HOOK.find((rule) => rule.pattern.test(haystack))?.label ?? null;
}

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
  /** Chiffres venant de /offre : delai, duree de la demande d'entree. */
  offerNumbers?: readonly number[];
  /** Entités homonymes écartées : leur nom ne doit jamais apparaître. */
  forbiddenNames?: readonly string[];
  /**
   * « À ne pas dire » du brief, vérifié et non plus seulement transmis.
   *
   * Le stratège écrit une consigne propre au prospect ; personne ne contrôlait
   * qu'elle était suivie, et le mail affirmait justement ce qu'elle interdisait.
   */
  avoid?: readonly string[];
  /**
   * Salutation imposee par le code (buildGreeting). Le mail doit s'ouvrir
   * EXACTEMENT par elle : « Bonjour Monsieur Briol, » ou « Bonjour, ».
   */
  greeting?: string;
  /** Horloge, pour juger qu'un fait a plus de douze mois. */
  now?: Date;
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
export function bodyParagraphs(body: string, signature?: string): string[] {
  const blocks = paragraphs(withoutSignature(body, signature));
  const withoutGreeting = /^bonjour\b/i.test(blocks[0] ?? "") ? blocks.slice(1) : blocks;

  // Quand la signature est FOURNIE, elle a deja ete retiree : appliquer en plus
  // l'heuristique « derniere ligne courte = signature » mangeait le bloc 4,
  // souvent tres court (« Est-ce que ca vous parlerait ? »).
  if (signature) return withoutGreeting;

  // Sans signature connue (donnees anterieures), on retombe sur l'heuristique.
  const last = withoutGreeting[withoutGreeting.length - 1] ?? "";
  const isSignature = last.split(/\s+/).length <= 4;
  return isSignature ? withoutGreeting.slice(0, -1) : withoutGreeting;
}

export function wordCount(body: string): number {
  return sharedWordCount(body);
}

/** Bornes de longueur par registre. « bref » est volontairement plus serré. */
/**
 * Bornes de longueur par registre.
 *
 * Le plafond de 110 mots avait ete calibre sur gpt-4o-mini. Les modeles gpt-6
 * n'acceptent pas `temperature: 0` et ecrivent une prose plus riche : ils
 * atterrissaient a 118-122 mots avec des notes de 4,4 a 4,8 sur 5. Le plafond
 * est fixe a 120, et c'est le bloc offre qui paie la difference : son budget
 * passe de 40 a 35 mots et il se limite a trois etapes de flux.
 */
function lengthBounds(tone: ToneKey): { min: number; max: number } {
  // Cible 100 mots, plafond 120 hors signature — STRICT. Les mails mesures a
  // 115-122 tenaient tous en 120 apres avoir resserre le bloc offre : c'est ce
  // bloc qui deborde, et un flux se decrit en trois etapes, pas en cinq.
  // 110 mots hors signature, STRICT (décision du 27/09/2026) : les mails de
  // référence écrits à la main tiennent en 95-105 mots.
  return tone === "bref" ? { min: 60, max: 95 } : { min: 75, max: MAX_BODY_WORDS };
}

/** Nombres écrits dans le corps, y compris « 41 M€ » et « 40,9 M ». */
export function numbersIn(text: string): number[] {
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
export function planApplied(plan: "A" | "B" | "C" | undefined, body: string, signature?: string): boolean {
  if (!plan) return true;
  const first = bodyParagraphs(body, signature)[0] ?? "";
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
export function questionsIn(body: string, signature?: string): string[] {
  return bodyParagraphs(withoutSignature(body, signature))
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

/** Même corps compté que l'écran et le contrôle avant envoi (lib/mail-preflight/words.ts) : sans signature ni phrase d'opposition. */
export function withoutSignature(body: string, signature?: string): string {
  return countedText(body, signature);
}

/**
 * Accroche generique, refusee.
 *
 * Le mail parti en production commençait par « Dans le commerce de gros,
 * passer une commande… » : une phrase vraie pour n'importe quel negociant de
 * France, donc une phrase qui ne dit rien de ce prospect. Une accroche qui
 * ouvre sur le secteur est une non-accroche.
 */
export function opensOnSector(body: string, signature?: string): boolean {
  const first = bodyParagraphs(body, signature)[0] ?? "";
  if (!first) return false;
  // « Dans le commerce de gros, » / « Dans la formation, » / « En interim, »
  return /^(dans|au sein d)\s+(le|la|les|l'|du|de|des)\s/i.test(first.trim());
}

/**
 * Le mail dit-il ce que le brief lui INTERDIT de dire ?
 *
 * Le stratège écrit un « à ne pas dire » propre au prospect — « ne pas
 * présenter l'inauguration comme faite, la date n'est pas connue ». Cette
 * consigne partait dans le prompt et personne ne vérifiait qu'elle était
 * suivie. Le mail sortait avec « vous venez d'inaugurer votre agence », qui est
 * exactement ce qu'on venait d'interdire.
 *
 * On ne peut pas juger une contradiction en toute généralité. On peut en
 * revanche repérer le cas qui se produit : le mail AFFIRME, au passé ou au
 * présent, ce dont la consigne dit qu'on n'est pas sûr. D'où la mécanique :
 *
 *   - on réduit la consigne à ses mots de FOND (les mots d'instruction —
 *     « présenter », « éviter », « jamais » — sont retirés) ;
 *   - une phrase du mail qui reprend au moins deux de ces mots est candidate ;
 *   - elle n'échoue que si elle AFFIRME : une hypothèse (« si », « pourrait »)
 *     ne contredit rien, c'est même la bonne façon d'en parler ;
 *   - et seulement si aucun fait autorisé ne porte déjà ces mots : quand le
 *     registre atteste le fait, le dire n'est pas une faute.
 */
const INSTRUCTION_WORDS = new Set([
  "affirmer",
  "annoncer",
  "comme",
  "connue",
  "connu",
  "dire",
  "eviter",
  "faite",
  "faits",
  "inconnue",
  "inconnu",
  "jamais",
  "mention",
  "mentionner",
  "parler",
  "presenter",
  "presente",
  "preciser",
  "sujet",
  "surtout",
  "aucune",
  "aucun",
  "encore",
  "puisque",
  "parce",
  "leur",
  "cette",
  "votre",
  "notre",
  "quand",
  "alors",
  "donc",
  "pas",
  "sans",
]);

/** Racine grossière : assez pour rapprocher « inauguration » et « inauguré ». */
const stem = (word: string): string => normalize(word).replace(/[^a-z]/g, "").slice(0, 6);

const contentStems = (line: string): Set<string> =>
  new Set(
    line
      .split(/[\s,.;:!?()«»"'’]+/)
      .filter((word) => word.length >= 5)
      .filter((word) => !INSTRUCTION_WORDS.has(normalize(word)))
      .map(stem)
      .filter((word) => word.length >= 4),
  );

/** Une phrase qui suppose ne contredit rien : c'est la bonne façon d'en parler. */
const HEDGED = /\b(si|s'il|si les|pourrait|peut|semble|souvent|imagine|suppose|hypoth|probable|sans doute|le cas|généralement|en général)\b/i;

export interface AvoidBreach {
  line: string;
  sentence: string;
}

export function contradictsAvoid(
  body: string,
  avoid: readonly string[],
  context: { facts?: readonly DerivedFact[]; signature?: string } = {},
): AvoidBreach | null {
  if (!avoid.length) return null;

  const factStems = new Set<string>();
  for (const fact of context.facts ?? []) {
    for (const item of contentStems(`${fact.label} ${fact.value}`)) factStems.add(item);
  }

  const sentences = bodyParagraphs(body, context.signature)
    .flatMap((block) => block.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (const line of avoid) {
    const wanted = [...contentStems(line)].filter((item) => !factStems.has(item));
    if (wanted.length < 2) continue;

    for (const sentence of sentences) {
      if (HEDGED.test(sentence)) continue;
      const stems = contentStems(sentence);
      const shared = wanted.filter((item) => stems.has(item));
      if (shared.length >= 2) return { line, sentence };
    }
  }
  return null;
}

/**
 * Accroches interdites qui restaient possibles.
 *
 * Trois formes, toutes vues en production :
 *
 *   - « Sur votre site, on lit que… » : citer le site comme une SOURCE le
 *     transforme en preuve qu'on les a lus, pas en fait qui les concerne ;
 *   - « Votre agence a ouvert… » sans date : un événement affirmé sans date se
 *     retourne dès que le lecteur se demande de quand on parle ;
 *   - la paraphrase de leur propre page : ils la connaissent, la leur relire ne
 *     leur apprend rien.
 */
const SITE_MENTION = new RegExp(
  [
    // « Sur votre site », « d'apres leur plaquette »…
    "(sur|d'apr[eè]s|selon)\\s+(votre|leur|le)\\s+(site|page|plaquette|brochure|pr[eé]sentation|descriptif)",
    // « Votre presentation relie… », « votre site indique… » : le document
    // devient SUJET de la phrase, ce qui revient au meme — on parle de leur
    // communication au lieu de parler d'eux. Vu sur MAISONS TERRE D'OC.
    "\\b(votre|leur)\\s+(site|page|plaquette|brochure|pr[eé]sentation|descriptif|profil|documentation|fiche)\\b",
    "on (lit|voit|peut lire) sur",
  ].join("|"),
  "i",
);

export function opensOnSiteMention(body: string, signature?: string): boolean {
  const first = bodyParagraphs(body, signature)[0] ?? "";
  return Boolean(first) && SITE_MENTION.test(first);
}

/** Marqueurs qui DATENT un événement, sans exiger une date au jour près. */
const DATE_MARKER =
  /\b(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre|20\d\d|cette ann[eé]e|ce mois|ce trimestre|au printemps|[àa] l'automne|cet [eé]t[eé]|cet hiver|depuis|il y a)\b/i;

/** Événement affirmé sur un établissement : « votre agence a ouvert… ». */
const EVENT_ON_SITE =
  /\b(votre|vos)\s+(nouvelles?\s+)?(agences?|[eé]tablissements?|sites?|bureaux|locaux|antennes?|succursales?)\b/i;
const DONE = /\b(a|avez|ont|est|sont)\s+(ouvert|inaugur|install|d[eé]m[eé]nag|repris|lanc|cr[eé][eé])/i;

export function undatedEventHook(body: string, signature?: string): boolean {
  const first = bodyParagraphs(body, signature)[0] ?? "";
  if (!first) return false;
  const asserts = EVENT_ON_SITE.test(first) && DONE.test(first);
  return asserts && !DATE_MARKER.test(first);
}

/**
 * Paraphrase creuse : « rappelle l'importance de… », « témoigne de… ».
 *
 * Une accroche dit UN fait, dans une phrase dont l'entreprise est le sujet.
 * Ces tournures commentent un fait au lieu de le dire, et se retrouvent mot
 * pour mot dans tous les mails générés.
 */
const HOLLOW_PARAPHRASE =
  /\b(rappelle|souligne|illustre|montre|traduit|refl[eè]te)\s+(bien\s+)?(l['’]\s*)?(importance|enjeu|place|r[oô]le|n[eé]cessit[eé])\b|\bt[eé]moigne(nt)?\s+d/i;

export function hollowParaphrase(body: string, signature?: string): string | null {
  const text = bodyParagraphs(body, signature).join(" ");
  return text.match(HOLLOW_PARAPHRASE)?.[0] ?? null;
}

/**
 * Une offre d'emploi est un INDICE du pain, pas le sujet du mail.
 *
 * Eval du 28/09/2026 : BRIOL (menuisier, 3 showrooms) s'ouvrait sur « Vous
 * recrutez un chauffeur-livreur », BONNIN (boulangerie) sur « Vous recrutez
 * une aide cuisine » — deux mails perdus contre la reference, qui partait du
 * metier (showrooms, laboratoire). Le recrutement peut justifier le pain ; il
 * n'ouvre pas le mail.
 */
const JOB_OFFER_HOOK =
  /^(vous\s+recrutez|vous\s+(cherchez|recherchez)\s+(un|une|des)\b|vous\s+avez\s+(publi[eé]|ouvert|mis\s+en\s+ligne)\s+(une|un)\s+(offre|poste|annonce)|votre\s+(offre|annonce)\s+(d['’]emploi|de\s+poste)|(une|votre)\s+offre\s+d['’]emploi)/i;

export function opensOnJobOffer(body: string, signature?: string): boolean {
  const hook = bodyParagraphs(body, signature)[0] ?? "";
  return JOB_OFFER_HOOK.test(hook.trim());
}

/** Un fait de plus de douze mois n'est jamais « récent ». */
const RECENT_WORDS =
  /\b(r[eé]cemment|derni[eè]rement|vient\s+d[e']|venez\s+d[e']|viennent\s+d[e']|tout\s+juste|fra[iî]chement|nouvelle?s?\s+(agence|boutique|showroom|magasin|site|[eé]tablissement))/i;

const YEAR_MS = 365 * 86_400_000;

export function oldFactAsRecent(
  body: string,
  facts: readonly DerivedFact[],
  signature?: string,
  now = new Date(),
): boolean {
  const hook = bodyParagraphs(body, signature)[0] ?? "";
  if (!RECENT_WORDS.test(hook)) return false;
  const dated = facts.map((fact) => Date.parse(fact.date ?? "")).filter((time) => !Number.isNaN(time));
  if (!dated.length) return false;
  return dated.every((time) => now.getTime() - time > YEAR_MS);
}

/**
 * L'accroche n'est-elle qu'une paraphrase de leur site ?
 *
 * Le fait de site reste une accroche LÉGITIME — c'est ce que l'entreprise dit
 * d'elle-même — mais il doit servir à dire quelque chose, pas être recopié.
 *
 * On mesure le RECOUVREMENT des mots de fond, pas des trigrammes : une
 * paraphrase réordonne (« Vente de biens de caractère, estimation » devient
 * « vous vendez des biens de caractère, avec estimation »), ce qui casse les
 * trigrammes tout en gardant tous les mots. Le recouvrement, lui, passe de
 * 0,15 à 1,00 entre une implication et une quasi-copie : la séparation est
 * nette, d'où un seuil au milieu.
 */
const PARAPHRASE_LIMIT = 0.6;

const SITE_STOPWORDS = new Set([
  "avec",
  "dans",
  "pour",
  "leur",
  "leurs",
  "vous",
  "nous",
  "votre",
  "vos",
  "notre",
  "nos",
  "des",
  "les",
  "une",
  "aux",
  "sur",
  "chez",
  "plus",
  "tout",
  "tous",
  "toute",
  "toutes",
  "ainsi",
  "entre",
]);

const siteWords = (text: string): string[] =>
  [
    ...new Set(
      text
        .split(/[\s,.;:!?()«»"'’/-]+/)
        .map((word) => normalize(word).replace(/[^a-z]/g, ""))
        .filter((word) => word.length >= 4 && !SITE_STOPWORDS.has(word))
        .map((word) => word.slice(0, 6)),
    ),
  ];

export function paraphrasesSite(
  body: string,
  facts: readonly DerivedFact[],
  signature?: string,
): boolean {
  const first = bodyParagraphs(body, signature)[0] ?? "";
  if (!first) return false;
  const opening = new Set(siteWords(first));

  return facts
    .filter((fact) => fact.key === "site_offer")
    .some((fact) => {
      const words = siteWords(fact.value);
      if (words.length < 4) return false;
      const shared = words.filter((word) => opening.has(word)).length;
      return shared / words.length > PARAPHRASE_LIMIT;
    });
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
  // Le delai de mise en place et la duree de la demande d'entree viennent de
  // /offre : ce sont nos chiffres, pas ceux du prospect. Les refuser comme
  // « absents des faits » etait un faux positif.
  for (const value of context.offerNumbers ?? []) known.add(value);
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
  if (!planApplied(context.plan, body, context.signature)) {
    failures.push(
      context.plan === "B"
        ? "Plan B : le mail doit s'ouvrir sur une question métier, pas sur un constat."
        : `Plan ${context.plan} : le mail doit s'ouvrir sur un constat, pas sur une question.`,
    );
  }

  // --- Accroche generique ---------------------------------------------------
  if (opensOnSector(body, context.signature)) {
    failures.push(
      "L'accroche ouvre sur le secteur (« Dans le/la… ») : elle serait vraie pour " +
        "n'importe quel concurrent. Pars d'un fait propre à cette entreprise.",
    );
  }

  // --- Phrases : une idee chacune, courtes, une seule question --------------
  //
  // Vu sur GLOBAL 2F : des phrases de trente mots qui enchainent deux idees, et
  // des formules qui ne disent rien (« revoir le suivi »). Le detail est dans
  // lib/emails/sentences.ts, avec la liste des formules bannies.
  for (const problem of sentenceProblems(withoutSignature(body, context.signature))) {
    failures.push(problem.message);
  }

  // --- Consigne « a ne pas dire » du brief ----------------------------------
  const breach = contradictsAvoid(body, context.avoid ?? [], {
    facts: context.facts,
    signature: context.signature,
  });
  if (breach) {
    failures.push(
      `Le brief interdit ceci : « ${breach.line} ». La phrase « ${breach.sentence} » le dit quand ` +
        "meme. Soit tu n'en parles pas, soit tu le poses en hypothese.",
    );
  }

  // --- Le site cite comme une source ---------------------------------------
  if (opensOnSiteMention(body, context.signature)) {
    failures.push(
      "L'accroche cite leur site comme source (« sur votre site… ») : ca prouve qu'on les a lus, " +
        "ca ne leur apprend rien. Pars du fait, pas de l'endroit ou tu l'as lu.",
    );
  }

  // --- Evenement affirme sans date -----------------------------------------
  if (undatedEventHook(body, context.signature)) {
    failures.push(
      "L'accroche affirme un evenement (ouverture, inauguration, demenagement) sans le dater : " +
        "donne le mois ou l'annee, ou n'affirme pas qu'il a eu lieu.",
    );
  }

  // --- Paraphrase de leur propre page --------------------------------------
  if (paraphrasesSite(body, context.facts, context.signature)) {
    failures.push(
      "L'accroche reprend presque mot pour mot ce que dit leur site : ils le connaissent. " +
        "Sers-t'en pour dire ce que ca implique, pas pour le leur relire.",
    );
  }

  // --- Paraphrase creuse ----------------------------------------------------
  const hollow = hollowParaphrase(body, context.signature);
  if (hollow) {
    failures.push(
      `Paraphrase creuse (« ${hollow} ») : dis le fait lui-même, dans une phrase simple dont ` +
        "l'entreprise est le sujet.",
    );
  }

  // --- Offre d'emploi en sujet ---------------------------------------------
  if (opensOnJobOffer(body, context.signature)) {
    failures.push(
      "L'accroche ouvre sur une offre d'emploi (« Vous recrutez… ») : c'est un indice du pain, pas le " +
        "sujet. Ouvre sur leur métier (implantations, clientèle, façon dont arrivent commandes et devis).",
    );
  }

  // --- Fait ancien presente comme recent -----------------------------------
  if (oldFactAsRecent(body, context.facts, context.signature, context.now)) {
    failures.push(
      "L'accroche présente comme récent un fait de plus de douze mois : retire « récemment », " +
        "« vient de »… ou date-le.",
    );
  }

  // --- Salutation imposee ----------------------------------------------------
  if (context.greeting && !normalize(body).startsWith(normalize(context.greeting))) {
    failures.push(`Salutation : le mail doit commencer exactement par « ${context.greeting} ».`);
  }

  // --- Accroche fondee sur la structure -------------------------------------
  const structure = opensOnStructure(body, context.signature);
  if (structure) {
    failures.push(
      `L'accroche s'appuie sur la structure juridique (« ${structure} ») : c'est un fait de ` +
        "ciblage, pas une accroche. Pars d'un signal daté ou de ce que dit leur site.",
    );
  }

  // --- Accroche fondee sur un fait brut du registre -------------------------
  const registry = opensOnRegistryFact(body, context.signature);
  if (registry) {
    failures.push(
      `L'accroche ouvre sur un fait brut du registre (${registry}) : c'est une donnee de ciblage, ` +
        "vraie pour mille entreprises. Decris une realite METIER observee : ce que dit leur site, " +
        "un signal date, leur activite concrete (ce qu'ils vendent, a qui, comment arrivent les demandes).",
    );
  }

  // --- Une seule question --------------------------------------------------
  const questions = questionsIn(body, context.signature);
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
  const first = context.greeting ? null : greetingName(context.contact);
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
  const blocks = bodyParagraphs(body, context.signature);
  if (blocks.length !== 4) {
    failures.push(
      `${blocks.length} paragraphe(s) de corps : il en faut EXACTEMENT 4 — accroche, ` +
        "qui + preuve, offre pour eux, demande.",
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
export function validateSubject(subject: string, _companyName?: string): string[] {
  const failures: string[] = [];
  const trimmed = subject.trim();
  // « Qui trie vos commandes ? » : le « ? » précédé de l'espace française n'est pas un mot.
  const words = trimmed.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));

  if (words.length < 2 || words.length > 6) {
    failures.push(`Objet de ${words.length} mot(s) : la cible est 2 à 6.`);
  }
  if (/^automatisation\s+(de|du|des)\b/i.test(trimmed)) {
    failures.push("Objet : « Automatisation de… » est interdit.");
  }
  // « Demandes de devis chez Menuiserie Briol » est l'objet de reference : le
  // nom COMMERCIAL est bienvenu. La raison sociale, elle, trahit l'annuaire.
  if (/\b(sarl|sas|sasu|eurl|sa|sci|snc)\b/i.test(trimmed)) {
    failures.push("Objet : pas de forme juridique (SARL, SAS…) — le nom commercial, ou rien.");
  }
  if (trimmed && /^\p{Ll}/u.test(trimmed)) {
    failures.push("Objet : il commence par une majuscule (« Demandes de devis… »).");
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
