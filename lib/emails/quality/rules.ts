import { knownNumbers, type DerivedFact } from "@/lib/emails/derived-facts";
import { numbersIn, validateSubject } from "@/lib/emails/validate";
import { ALLOWED_DEMO_URLS, demoForProposal, DEMO_LINKS, type DemoLink } from "./demo-links";
import { avecAllowed, opensWithAvec } from "./readiness";
import { countWords, PROOF_PREFIX, sentencesOf, type MailParts } from "./template";

/**
 * GARDE-FOU DÉTERMINISTE du gabarit qualité. Chaque message est une consigne
 * de réécriture : il dit quoi changer, pas seulement ce qui ne va pas.
 *
 * Les règles viennent de la relecture d'Axel du 03/10/2026 (6 brouillons,
 * ~5/10) : salutation impersonnelle, offre d'emploi citée, jargon (« flux »,
 * « RHD »), phrases à rallonge, étapes techniques, preuve sans lien.
 */

export const LIMITS = {
  hookSentences: 2,
  sentenceWords: 20,
  proposalWords: 32,
  /** Corps (salutation → demande), sans mention « stop » ni signature. */
  minWords: 50,
  targetWords: 90,
  maxWords: 110,
} as const;

/** Mots que le prospect n'emploie pas, ou qui sonnent « éditeur de logiciel ». */
export const FORBIDDEN_WORDS = [
  "flux",
  "workflow",
  "workflows",
  "pipeline",
  "api",
  "process",
  "processus",
  "solution",
  "plateforme",
  "logiciel",
  "rhd",
  "pièces de mission",
  "fiche d'affectation",
  "fiches d'affectation",
  "synergie",
  "optimiser",
  "digitaliser",
  "levier",
] as const;

/** Sigles autorisés d'office : on les emploie tous. */
const COMMON_ACRONYMS = new Set(["PME", "TVA", "HT", "TTC"]);

const JOB_OFFER = /(offre(s)? d['’]emploi|vous recrutez|recrute[rz]?\b|recrutement|votre annonce|l['’]annonce|poste de|postes? (ouvert|à pourvoir)|candidat|embauch|\bh\s*\/\s*f\b|\bf\s*\/\s*h\b|\bcdi\b|\bcdd\b|offre de (préparateur|comptable|assistant|technicien|commercial))/i;
const REGISTRY = /(\bsalarié|\bsalarie|effectif|chiffre d['’]affaires|\bca de\b|capital social|\bnaf\b|code ape|cr[ée]{1,2}e en \d{4}|fond[ée]e en \d{4}|depuis \d{4}|immatricul|\bsiren\b|\bsiret\b|\bk€|\bm€|millions? d['’]euros)/i;
const SITE_AS_SOURCE = /(sur votre site|d['’]apr[èe]s votre site|votre site (indique|pr[ée]sente|mentionne)|j['’]ai vu (que|sur)|en parcourant)/i;
const VAGUE_PROOF = /(exemples? testables?|sur mon site|démos? en ligne)/i;

/**
 * Règles Cowork (itération 1, 04/10/2026) — ce qui faisait perdre 2 à 4 points.
 *
 * 1. Ouvertures qui DÉCRIVENT au lieu de poser un fait : « Dans le commerce de
 *    gros… », « Spi Energie travaille dans… », « Vous fabriquez… ».
 * 2. Conséquence molle : « prend du temps ». Il faut un effet observable
 *    (client qui attend, retard, double saisie, relance oubliée, devis tardif).
 * 3. Hypothèse visible : « si vos demandes… ».
 * 4. Clichés de fin : un seul « sans ressaisie / sans oubli », et pas celui déjà
 *    servi dans les autres mails du jour.
 */
export const DESCRIPTIVE_OPENING =
  /^(dans (le|la|les|l['’]|un|une)\s|en tant que\b|[^.]{0,60}?\b(travaille|travaillent|est sp[ée]cialis[ée]e?|sont sp[ée]cialis[ée]s|op[èe]re|intervient|est active?|[ée]volue) (dans|en|sur)\b|vous (vendez|fabriquez|[êe]tes|proposez|distribuez|produisez|concevez|commercialisez)\b)/iu;
/** « Spi Energie vend… » : le NOM en sujet d'un verbe de description (sensible à la casse). */
export const NAME_DESCRIBES = /^[A-ZÀ-Ý][\w&.' -]{1,40} (vend|fabrique|distribue|produit|commercialise|est un|est une)\b/u;
export const SOFT_CONSEQUENCE =
  /(prend(re)?( aussi| souvent| vite)? (du|beaucoup de|un) temps|peut (vite |aussi )?prendre du temps|prend du temps|chronophage|demande (de l['’][ée]nergie|du temps|beaucoup de temps)|co[uû]te (du|beaucoup de) temps|mobilise du temps)/i;
export const VISIBLE_HYPOTHESIS = /\bsi (vos|vous|ces|des|votre|les|leurs?|elles?|ils?)\b|s['’]ils?\b|[ée]ventuellement|peut-[êe]tre|le cas [ée]ch[ée]ant/i;
export const ENDING_CLICHES = /sans (ressaisie|oubli|erreur|double saisie|perte)|\bni (oubli|ressaisie|erreur|double saisie|perte)/gi;

/**
 * RÉPÉTITION (décision Cowork, itération 2) : un même groupe nominal au plus
 * DEUX fois dans le mail, objet compris. KOMAKS disait trois fois « commandes
 * de consommables ». On compte les groupes « nom (de|des|du) nom » et les paires
 * de mots pleins.
 */
const GROUP_STOP = new Set([
  "pour", "avec", "dans", "votre", "vos", "chaque", "leur", "leurs", "sont", "est", "une", "des", "les", "par", "sur", "aux", "qui",
  "que", "cette", "ces", "tout", "tous", "plus", "j'automatise", "type", "tâche", "pme", "reçues", "reçus", "reçue", "e-mail",
]);
export function repeatedGroups(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[^a-zà-ÿ'-]+/)
    .filter(Boolean);
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const full = (word: string) => word.length >= 4 && !GROUP_STOP.has(word);
  for (let index = 0; index < words.length - 1; index += 1) {
    const [a, b, c] = [words[index], words[index + 1], words[index + 2]];
    if (full(a) && ["de", "des", "du", "d'"].includes(b) && c && full(c)) bump(`${a} ${b} ${c}`);
    else if (full(a) && full(b)) bump(`${a} ${b}`);
  }
  return [...counts.entries()].filter(([, count]) => count > 2).map(([group]) => group);
}

/** Le cliché de fin d'une proposition (pour varier entre les mails du jour). */
export const clichesOf = (text: string) => [...new Set((text.match(ENDING_CLICHES) ?? []).map((value) => value.toLowerCase()))];

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export interface RuleContext {
  greeting: string;
  /** Faits autorisés : les seuls nombres permis en viennent. */
  facts: DerivedFact[];
  /** Ce que le prospect écrit lui-même (site, profil, offre) : ses sigles sont permis. */
  prospectText: string;
  companyName: string;
  forbiddenNames?: readonly string[];
  offerNumbers?: readonly number[];
  /** Clichés de fin déjà servis dans les autres mails du jour : à ne pas reprendre. */
  usedCliches?: readonly string[];
  /** Démo retenue : elle doit illustrer la phrase « J'automatise… ». */
  demo?: DemoLink["key"];
  /** Brouillons déjà écrits aujourd'hui, et combien ouvrent sur « Avec ». */
  dayOpenings?: { total: number; avec: number };
}

export interface RuleResult {
  ok: boolean;
  failures: string[];
}

function wordHit(text: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}])${normalize(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u");
  return pattern.test(normalize(text));
}

export function checkMail(parts: MailParts, body: string, context: RuleContext): RuleResult {
  const failures: string[] = [];
  const written = `${parts.hook}\n${parts.proposal}`;

  // --- Salutation : posée par le code, on vérifie qu'elle n'est pas doublée.
  if (!body.startsWith(context.greeting)) failures.push(`Salutation : le mail doit commencer par « ${context.greeting} ».`);
  if (/\bbonjour\b/i.test(written)) failures.push("Accroche : pas de seconde salutation, elle est déjà posée.");

  // --- Accroche : 2 phrases au plus, 20 mots chacune.
  const hook = sentencesOf(parts.hook);
  if (!hook.length) failures.push("Accroche vide : un fait concret sur l'entreprise, puis sa conséquence.");
  if (hook.length > LIMITS.hookSentences) failures.push(`Accroche en ${hook.length} phrases : deux au plus (le fait, puis sa conséquence).`);
  for (const sentence of [...hook, ...sentencesOf(parts.proposal)]) {
    const words = countWords(sentence);
    if (sentence !== parts.proposal.trim() && words > LIMITS.sentenceWords) {
      failures.push(`Phrase de ${words} mots (« ${sentence.slice(0, 60)}… ») : 20 au plus, coupe-la.`);
    }
    if (/;/.test(sentence)) failures.push(`Point-virgule (« ${sentence.slice(0, 50)}… ») : fais deux phrases courtes ou supprimes-en une.`);
  }

  // --- Règles Cowork : décrire n'est pas accrocher, « prend du temps » n'est pas une conséquence.
  const opening = parts.hook.trim().match(DESCRIPTIVE_OPENING) ?? parts.hook.trim().match(NAME_DESCRIBES);
  if (opening) failures.push(`Accroche descriptive (« ${opening[0].trim()} ») : pose un FAIT PROPRE comme contexte (sites, gamme, clientèle), pas une description de leur métier ou de leur secteur.`);
  const soft = written.match(SOFT_CONSEQUENCE);
  if (soft) failures.push(`Conséquence molle (« ${soft[0]} ») : dis l'effet observable — client qui attend, retard de livraison, double saisie, relance oubliée, devis qui part tard.`);
  const hypothesis = written.match(VISIBLE_HYPOTHESIS);
  if (hypothesis) failures.push(`Hypothèse visible (« ${hypothesis[0]} ») : affirme ce que tu sais, ou n'en parle pas.`);
  const cliches = written.match(ENDING_CLICHES) ?? [];
  if (cliches.length > 1) failures.push(`${cliches.length} clichés de fin (${cliches.join(", ")}) : un seul par mail.`);
  const repeated = clichesOf(written).filter((value) => (context.usedCliches ?? []).includes(value));
  if (repeated.length) failures.push(`« ${repeated[0]} » est déjà dans un autre mail du jour : formule le bénéfice autrement.`);

  const repeated3 = repeatedGroups(`${parts.subject}. ${written}`);
  if (repeated3.length) failures.push(`« ${repeated3[0]} » revient plus de deux fois : varie (pronom, synonyme, ou supprime une occurrence).`);

  // --- La démo illustre ce que dit la proposition (SPI ENERGIE : tri des
  // e-mails dans la phrase, agent devis dans le lien).
  if (context.demo) {
    const said = demoForProposal(parts.proposal);
    if (said.key !== "general" && said.key !== context.demo) {
      failures.push(`Démo incohérente : la proposition parle de « ${said.label} » mais le lien montre « ${DEMO_LINKS[context.demo].label} ». Aligne la phrase sur la démo, ou l'inverse.`);
    }
    if (said.key === "general" && context.demo === "devis") {
      failures.push("Démo incohérente : le lien montre l'agent devis, mais la proposition ne parle pas de préparer un devis.");
    }
  }
  if (opensWithAvec(parts.hook) && !avecAllowed(context.dayOpenings)) {
    failures.push("Ouverture « Avec… » déjà trop fréquente aujourd'hui (au plus un mail sur trois) : ouvre autrement (« Chez… », « Entre… et… », « Quand… », ou le fait en sujet).");
  }

  // --- Proposition : une phrase, un bénéfice, pas une liste d'étapes.
  const proposal = sentencesOf(parts.proposal);
  if (proposal.length !== 1) failures.push(`Proposition en ${proposal.length} phrases : une seule.`);
  const proposalWords = countWords(parts.proposal);
  if (proposalWords > LIMITS.proposalWords) failures.push(`Proposition de ${proposalWords} mots : ${LIMITS.proposalWords} au plus.`);
  const steps = (parts.proposal.match(/,|\bpuis\b|\bensuite\b|\bet enfin\b/gi) ?? []).length;
  if (steps >= 3) failures.push("Proposition : c'est une liste d'étapes techniques. Dis le bénéfice (temps gagné, erreurs ou retards évités).");

  // --- Vocabulaire.
  const words = FORBIDDEN_WORDS.filter((word) => wordHit(`${parts.subject}\n${written}`, word));
  if (words.length) failures.push(`Mots interdits : ${words.join(", ")}. Dis-le avec les mots du métier du prospect.`);
  const prospect = context.prospectText;
  const acronyms = [...new Set(`${parts.subject} ${written}`.match(/\b[A-Z]{2,5}\b/g) ?? [])].filter(
    (acronym) => !COMMON_ACRONYMS.has(acronym) && !new RegExp(`\\b${acronym}\\b`).test(prospect) && acronym !== context.companyName,
  );
  if (acronyms.length) failures.push(`Sigles que le prospect n'emploie pas : ${acronyms.join(", ")}. Écris le mot en entier.`);

  // --- Interdits de fond.
  if (JOB_OFFER.test(`${parts.subject} ${written}`)) failures.push("Offre d'emploi ou recrutement mentionné : interdit. Pars de leur activité, jamais de l'annonce.");
  if (REGISTRY.test(parts.hook)) failures.push("Accroche fondée sur une donnée de registre (effectif, chiffre d'affaires, date de création) : décris une réalité métier.");
  if (SITE_AS_SOURCE.test(written)) failures.push("Ne cite pas leur site comme source (« sur votre site… ») : dis le fait.");
  if (VAGUE_PROOF.test(written)) failures.push("Pas de « exemples testables sur mon site » : la preuve est la ligne avec le lien, posée à part.");
  if (/https?:\/\/|www\.|axelremillat/i.test(written)) failures.push("Aucune URL dans l'accroche ni la proposition : le lien de démo est posé par le code.");
  if (/\?/.test(written)) failures.push("Aucune question hors de la demande finale.");

  // --- Preuve : présente, et vers une démo qui existe.
  const proof = body.split("\n").find((line) => line.startsWith(PROOF_PREFIX));
  const url = proof?.slice(PROOF_PREFIX.length).trim();
  if (!url || !ALLOWED_DEMO_URLS.includes(url)) failures.push("Lien de démo absent ou inconnu.");

  // --- Nombres : seulement ceux des faits (15 minutes vient de la demande).
  const known = knownNumbers(context.facts);
  for (const value of context.offerNumbers ?? []) known.add(value);
  const invented = numbersIn(written).filter((value) => !known.has(value) && !known.has(Math.round(value)));
  if (invented.length) failures.push(`Nombre absent des faits : ${[...new Set(invented)].join(", ")}.`);

  // --- Noms.
  if (context.companyName === context.companyName.toUpperCase() && context.companyName.length > 3 && written.includes(context.companyName)) {
    failures.push("Nom de l'entreprise en capitales : écris-le en casse naturelle.");
  }
  const foreign = (context.forbiddenNames ?? []).filter((name) => normalize(written).includes(normalize(name)));
  if (foreign.length) failures.push(`Nom d'une autre entreprise : ${foreign.join(", ")}.`);

  // --- Longueur totale.
  const total = countWords(body);
  if (total > LIMITS.maxWords) failures.push(`${total} mots : ${LIMITS.maxWords} au plus (cible 60 à 90). Retire environ ${total - LIMITS.targetWords} mots.`);
  if (total < LIMITS.minWords) failures.push(`${total} mots : trop court, l'accroche doit poser un fait et sa conséquence.`);

  failures.push(...validateSubject(parts.subject, context.companyName));
  return { ok: failures.length === 0, failures };
}
