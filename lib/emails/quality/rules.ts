import { dafFailures, ENTRE_OPENING } from "./daf";
import { knownNumbers, type DerivedFact } from "@/lib/emails/derived-facts";
import { numbersIn, validateSubject } from "@/lib/emails/validate";
import { ALLOWED_DEMO_URLS, demoForProposal, DEMO_LINKS, SUPPLIER_SIDE, type DemoLink } from "./demo-links";
import { avecAllowed, opensWithAvec } from "./readiness";
import { subjectArmProblem, type SubjectArm } from "./experiment";
import { countWords, sentencesOf, type MailParts } from "./template";
import { bareDemoUrl, demoTextOf, FAMILY_LIMITS, type MailFamily } from "./families";
import { DEMO_HOST } from "./demo-links";

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
  /** Corps (salutation → demande), sans mention « stop » ni signature : 60 à 90 mots (05/10/2026). */
  minWords: 60,
  targetWords: 80,
  maxWords: 90,
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
  /** Douleur DAF / RAF : le mail parle du rapprochement des factures fournisseurs (Cowork #44). */
  daf?: boolean;
  /** « Entre … et … » déjà utilisé dans les derniers brouillons prêts (Cowork #44). */
  avoidEntre?: boolean;
  /** Démo retenue : elle doit illustrer la phrase « J'automatise… ». */
  demo?: DemoLink["key"];
  /** Brouillons déjà écrits aujourd'hui, et combien ouvrent sur « Avec ». */
  dayOpenings?: { total: number; avec: number; byFamily?: Partial<Record<string, { total: number; avec: number }>> };
  /** Expérience n° 1 : style d'objet imposé. */
  subjectArm?: SubjectArm;
  /** Famille du mail (expérience n° 2) : F1 par défaut. */
  family?: MailFamily;
  /** Ce que l'on sait d'eux (activité, secteur, tâche) : ancrage des faits de F2 et F4. */
  knownText?: string;
}

export interface RuleResult {
  ok: boolean;
  failures: string[];
}

export function wordHit(text: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}])${normalize(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u");
  return pattern.test(normalize(text));
}

/**
 * F4 — DÉMO HONNÊTE (Cowork, 05/10/2026, DUPONT-BEAUDEUX) : « Elle lit une
 * commande de vêtements professionnels et prépare la facture » laissait croire
 * que la démo avait été faite sur LEUR métier. Elle est générique : on décrit
 * un cas TYPE, puis on dit que le même principe s'appliquerait chez eux.
 */
export const F4_TYPE_CASE = /\b(types?|g[ée]n[ée]riques?|d['’]exemple|fictive?s?)\b/i;
// Cowork #40 : transpositions conditionnelles honnêtes (« un principe que je pourrais adapter à vos… », « pour vos commandes
// fournisseurs, je signalerais… ») — 5 refus F4 sur 6 venaient d'une formule correcte mais non prévue.
export const F4_TRANSPOSE = /(m[êe]me principe|appliqu(er|erais|erait|erions) (ce|le m[êe]me) principe|s['’]appliquerai(t|ent)|pourrai(t|ent) s['’]appliquer|s['’]adapterai(t|ent)|de la m[êe]me (fa[çc]on|mani[èe]re)|m[êe]me logique|chez vous, (elle|cela|ce serait)|principe que je pourrais (adapter|appliquer)|que je pourrais (adapter|appliquer) à vos|comme je (peux|pourrais) le faire pour|pour vos [^.;]{3,80}, je (signalerais|préparerais|ferais|repérerais|relèverais))/i;

/**
 * F2 — PREMIÈRE PERSONNE, VOIX ACTIVE (AIRPLANE DELIVERY : « les demandes…
 * sont triées, puis une commande… est préparée » — on ne sait pas qui fait quoi).
 */
export const F2_FIRST_PERSON = /^\s*(je |j['’])/i;
/** Documents de gestion : leur énumération (« factures, commandes et bons de livraison ») compte pour un seul objet. */
const DOCUMENT = String.raw`(factures?(?:\s+fournisseurs?)?|commandes?|bons?\s+de\s+(?:livraison|commande)|BL|devis|avoirs?|relevés?|bordereaux)`;
const DOCUMENT_LIST = new RegExp(String.raw`${DOCUMENT}(?:\s*,\s*${DOCUMENT})*\s+et\s+${DOCUMENT}`, "gi");
export const collapseDocumentLists = (text: string) => text.replace(DOCUMENT_LIST, "documents");

/**
 * Apposition en tête de phrase sans rapport avec le sujet (Cowork #45) : « Grossiste pour les métiers de
 * bouche, un bon de livraison manquant… ». Un nom de métier, une virgule, puis un AUTRE sujet (déterminant).
 */
export const DANGLING_APPOSITION =
  /^\s*(grossiste|fabricant|distributeur|sp[ée]cialiste|leader|acteur|n[ée]gociant|producteur|transporteur|installateur|concepteur|industriel|importateur|exportateur|entreprise|soci[ée]t[ée]|pme|artisan|prestataire|bureau d['’][ée]tudes?|cabinet)\b[^,.;]{0,90},\s+(un|une|le|la|les|l['’]|des|chaque|aucun|aucune|ce|cette|ces|cet)\b/i;

/** Ouverture par la démo (gabarit F4 refusé par Cowork #34) : « Elle lit… », « Dans la démo… », « Une démo… ». */
export const DEMO_OPENING = /^\s*(elle\s|dans\s+(la|cette|une)\s+d[ée]mo|(une|la|cette)\s+d[ée]mo)/i;
export const PASSIVE_VOICE = /\b(est|sont|serait|seraient|sera|seront|soit|soient)\s+(automatiquement\s+|ensuite\s+|alors\s+|directement\s+)?[a-zàâçéèêëîïôûùüÿœ]+(é|ée|és|ées)\b/i;

/**
 * F2 et F4 — AUCUN FAIT NON SOURCÉ : les mots précis qui décrivent leur
 * activité (« avions régionaux ») doivent venir de ce que l'on sait d'eux
 * (site, registre, profil). Au-delà d'un mot introuvable, on refuse.
 */
const GENERIC_WORDS = new Set(
  "entreprise entreprises demande demandes commande commandes client clients clientes devis facture factures fournisseur fournisseurs livraison livraisons reponse reponses relance relances retard retards delais delai confirmation confirmations reference references quantites quantite verifier verification preparer preparation prepare preparee souvent chaque attente attendre intervention interventions rendez equipe equipes dossier dossiers document documents message messages courriel courriels mail mails e-mail e-mails boite reception service services suivi tableau tableur outil outils planning automatisation automatise automatiser propose proposer valider validation validee brouillon brouillons ressaisie saisie saisir information informations donnees tache taches activite metier metiers secteur production fabrication atelier ateliers chantier chantiers stock stocks article articles produit produits catalogue tarif tarifs prix paiement paiements encaissement relancer classer classement trier triees aiguiller aiguillage orienter traitement traiter commerciale commercial administratif administrative gestion gestionnaire semaine journee matin quotidien regulierement rapidement directement concretement exemple principe appliquerait correspondante correspondant adaptee adaptees habituelle habituellement".split(" "),
)
const plainWord = (word: string) => word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function unsourcedTerms(text: string, known: string): string[] {
  const knownStems = new Set(plainWord(known).split(/[^a-z0-9]+/).filter((word) => word.length >= 5).map((word) => word.slice(0, 6)));
  const words = plainWord(text).split(/[^a-z0-9-]+/).filter((word) => word.length >= 7 && !GENERIC_WORDS.has(word));
  return [...new Set(words.filter((word) => !knownStems.has(word.slice(0, 6))))];
}

/**
 * Le passage qui DÉCRIT leur activité : l'ouverture de F2 (jusqu'à la
 * première virgule : « Pour une entreprise de maintenance d'avions
 * régionaux ») ou, en F4, ce qui suit « s'appliquerait à ». Les verbes et le
 * reste de la phrase ne sont pas des faits sur eux.
 */
export function activityClause(family: MailFamily, hook: string): string {
  if (family === "F4") return hook.split(/s['’]appliquerai(?:t|ent)\s+(?:à|aux|au)\s+/i)[1] ?? "";
  return (sentencesOf(hook)[0] ?? "").split(",")[0] ?? "";
}

function familyFailures(family: MailFamily, parts: MailParts, context: RuleContext): string[] {
  const failures: string[] = [];
  if (family === "F4") {
    // Cowork #34 : la démo vient APRÈS le fait et le problème — jamais en ouverture.
    if (DEMO_OPENING.test(parts.hook)) failures.push("F4 : n'ouvre jamais par la démo (« Elle lit… », « Dans la démo… ») : un fait propre à l'entreprise, puis le problème qui en découle ; la démo vient ensuite, en preuve.");
    // Cowork #36 : l'accroche F4 pose le fait et le problème ; « je signale », « je peux préparer » n'y ont pas leur place.
    if (/(^|[\s.;:,])(je\s|j['’]\w)/i.test(parts.hook)) failures.push("F4 : l'accroche pose le fait et le problème, sans « je » (« je signale l'écart », « je peux préparer » viennent de la démo, pas de l'accroche).");
    // Cowork #35 : c'est la démo qui lit, pas Axel (« Je lis une demande type… » refusé).
    if (/^\s*je\s/i.test(parts.proposal)) failures.push("F4 : la phrase de démo a la démo pour sujet (« La démo montre une demande type lue et une confirmation prête à valider… »), jamais « Je lis… ».");
    if (!F4_TYPE_CASE.test(parts.proposal) || !F4_TRANSPOSE.test(parts.proposal)) {
      failures.push("F4 — démo honnête : la démo est générique. Décris un cas TYPE (« Elle lit une commande type et prépare la facture à valider ») puis « le même principe s'appliquerait à vos … ». Ne laisse jamais croire qu'elle a été faite sur leur métier.");
    }
  }
  // F1, F2, F3 : proposition à la 1re personne (grille Cowork du 06/10). Après « J'automatise ce tri : »,
  // décrire ce qui se passe au passif reste permis (version ANTARES de Cowork, notée 9) ; en F2, la phrase
  // entière au passif (« les demandes sont triées, puis… », AIRPLANE) est refusée.
  if (family !== "F4" && !F2_FIRST_PERSON.test(parts.proposal)) {
    failures.push("La proposition commence à la première personne (« J'automatise… », « Je mets en place… », « Je construis… »).");
  }
  // Passif après « J'automatise ce tri : » : permis par le code (mails validés par Axel) ; la voix active est
  // imposée au RÉDACTEUR et jugée par C5 (Cowork #34, PLIMETAL). En F2, la phrase entière au passif est refusée.
  if (family === "F2") {
    const passive = parts.proposal.replace(/^[^:]*:/, "").match(PASSIVE_VOICE);
    if (passive && !/:/.test(parts.proposal)) failures.push(`Voix passive (« ${passive[0]} ») — dis qui fait quoi, à la première personne et à la voix active.`);
  }
  if ((family === "F2" || family === "F4") && context.knownText !== undefined) {
    const unsourced = unsourcedTerms(activityClause(family, family === "F4" ? parts.proposal : parts.hook), `${context.knownText} ${context.prospectText} ${context.facts.map((fact) => fact.value).join(" ")}`);
    if (unsourced.length >= 2) failures.push(`Faits non sourcés (${unsourced.slice(0, 3).join(", ")}) : ne décris leur activité qu'avec ce que l'on sait d'eux (site, registre).`);
  }
  return failures;
}

export function checkMail(parts: MailParts, body: string, context: RuleContext): RuleResult {
  const failures: string[] = [];
  const family = context.family ?? "F1";
  const written = `${parts.hook}\n${parts.proposal}`;

  // --- Salutation : posée par le code, on vérifie qu'elle n'est pas doublée.
  if (!body.startsWith(context.greeting)) failures.push(`Salutation : le mail doit commencer par « ${context.greeting} ».`);
  if (/\bbonjour\b/i.test(written)) failures.push("Accroche : pas de seconde salutation, elle est déjà posée.");

  // --- Accroche : 2 phrases au plus, 20 mots chacune.
  const hook = sentencesOf(parts.hook);
  if (!hook.length) failures.push("Accroche vide : un fait concret sur l'entreprise, puis sa conséquence.");
  if (family === "F3") {
    // F3 : UNE question courte sur qui gère la tâche.
    if (hook.length !== 1 || !parts.hook.trim().endsWith("?")) failures.push("F3 : l'ouverture est UNE question courte, qui finit par « ? » (« Qui s'occupe de … chez vous ? »).");
  } else if (hook.length > LIMITS.hookSentences) failures.push(`Accroche en ${hook.length} phrases : deux au plus (le fait, puis sa conséquence).`);
  for (const sentence of [...hook, ...sentencesOf(parts.proposal)]) {
    const words = countWords(sentence);
    // F4 : la formule de la démo (« … type … ; le même principe s'appliquerait à … ») tient en une phrase plus longue.
    const sentenceMax = family === "F4" && sentence === parts.proposal.trim() ? 32 : LIMITS.sentenceWords;
    if (sentence !== parts.proposal.trim() && words > sentenceMax) {
      failures.push(`Phrase de ${words} mots (« ${sentence.slice(0, 60)}… ») : ${sentenceMax} au plus, coupe-la.`);
    }
    // F4 : la formule attendue (« … ; le même principe s'appliquerait à … ») porte un point-virgule.
    if (!(family === "F4" && sentence === parts.proposal.trim()) && /;/.test(sentence)) failures.push(`Point-virgule (« ${sentence.slice(0, 50)}… ») : fais deux phrases courtes ou supprimes-en une.`);
  }

  // --- Règles Cowork : décrire n'est pas accrocher, « prend du temps » n'est pas une conséquence.
  // F1 seulement : F2 et F4 partent justement de l'activité (« Dans une entreprise qui… »).
  // Cowork #45 (CENTRAL ALCOR) : « Grossiste pour les métiers de bouche, un bon de livraison manquant… » —
  // l'apposition en tête ne se rapporte pas au sujet de la phrase : faute de français.
  const apposition = hook.map((sentence) => sentence.match(DANGLING_APPOSITION)).find(Boolean);
  if (apposition) failures.push(`Apposition qui ne se rapporte pas au sujet (« ${apposition[0].trim()}… ») : écris « Vous êtes grossiste… » ou ouvre directement sur le fait.`);
  const opening = family === "F1" ? (parts.hook.trim().match(DESCRIPTIVE_OPENING) ?? parts.hook.trim().match(NAME_DESCRIBES)) : null;
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
    const said = demoForProposal(demoTextOf(family, parts));
    if (said.key !== "general" && said.key !== context.demo) {
      failures.push(`Démo incohérente : la proposition parle de « ${said.label} » mais le lien montre « ${DEMO_LINKS[context.demo].label} ». Aligne la phrase sur la démo, ou l'inverse.`);
    }
    if (context.demo === "devis" && SUPPLIER_SIDE.test(`${parts.hook} ${parts.proposal}`)) {
      failures.push("Démo incohérente : le lien montre l'agent devis CLIENT, mais le mail parle de devis ou commandes FOURNISSEURS (démo factures ou tri des e-mails).");
    }
    if (said.key === "general" && context.demo === "devis") {
      failures.push("Démo incohérente : le lien montre l'agent devis, mais la proposition ne parle pas de préparer un devis.");
    }
  }
  // Quota « Avec » : un mail sur trois au plus — sur la journée ET au sein de la famille (BULLY, CAMEL DIAM : 2 F1 sur 2).
  // Cowork #44 : DAF / RAF ancré sur le rapprochement des factures ; « Entre … et … » limité.
  if (context.daf) failures.push(...dafFailures(`${parts.subject} ${parts.hook} ${parts.proposal}`));
  if (context.avoidEntre && ENTRE_OPENING.test(parts.hook)) {
    failures.push("Ouverture « Entre … et … » déjà utilisée dans les derniers mails prêts : pose le fait en sujet, ou « Chez … », « Quand … ».");
  }
  const familyDay = context.dayOpenings?.byFamily?.[family];
  if (opensWithAvec(parts.hook) && (!avecAllowed(context.dayOpenings) || (familyDay && !avecAllowed(familyDay)))) {
    failures.push("Ouverture « Avec… » déjà trop fréquente aujourd'hui (au plus un mail sur trois) : ouvre autrement (« Chez… », « Entre… et… », « Quand… », ou le fait en sujet).");
  }

  // --- Proposition : une phrase, un bénéfice, pas une liste d'étapes (F4 : ligne imposée, rien à vérifier).
  const proposal = family === "F4" ? [parts.proposal] : sentencesOf(parts.proposal);
  if (proposal.length !== 1) failures.push(`Proposition en ${proposal.length} phrases : une seule.`);
  const proposalWords = countWords(parts.proposal);
  if (family !== "F4" && proposalWords > LIMITS.proposalWords) failures.push(`Proposition de ${proposalWords} mots : ${LIMITS.proposalWords} au plus.`);
  // « Concrètement, … » (F2) n'est pas une étape.
  // Cowork #45 : « factures fournisseurs, commandes et bons de livraison » est UN objet (une énumération de
  // documents), pas trois étapes ; elle est ramenée à un seul mot avant de compter.
  const steps = family === "F4" ? 0 : (collapseDocumentLists(parts.proposal).replace(/^\s*concr[èe]tement\s*,/i, "").match(/,|\bpuis\b|\bensuite\b|\bet enfin\b/gi) ?? []).length;
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
  // F3 : la question d'ouverture est permise, aucune autre.
  const questions = family === "F3" ? `${parts.hook.trim().replace(/\?$/, "")}\n${parts.proposal}` : written;
  if (/\?/.test(questions)) failures.push("Aucune question hors de la demande finale.");

  // --- Preuve : présente, et vers une démo qui existe.
  const proof = body.split("\n").find((line) => line.includes(DEMO_HOST));
  const url = proof?.slice(proof.indexOf(DEMO_HOST)).trim();
  if (!url || !ALLOWED_DEMO_URLS.includes(bareDemoUrl(url))) failures.push("Lien de démo absent ou inconnu.");
  // Lien COMPLET (ANTARES, 06/10 : « automatisations?v=3 » sans démo → page générique).
  else if (bareDemoUrl(url) === `${DEMO_HOST}/automatisations`) failures.push("Lien de démo incomplet : il faut une démo précise (?demo=email, invoice, sav… ou /agent), jamais la page générique.");

  // --- Nombres : seulement ceux des faits (15 minutes vient de la demande).
  const known = knownNumbers(context.facts);
  // Cowork #34 (ICP LOGISTIQUE, « 4 000 commandes par heure ») : un nombre lu sur le site ou dans
  // key_figures.facts n'est pas inventé. Le lien entre ce nombre et le problème, c'est au juge de le dire.
  for (const value of numbersIn(`${context.prospectText ?? ""} ${context.knownText ?? ""}`)) known.add(value);
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
  const { min, max } = FAMILY_LIMITS[family];
  if (total > max) failures.push(`${total} mots : ${max} au plus pour ce mail (${min} à ${max}). Retire environ ${total - max + 5} mots.`);
  if (total < min) failures.push(`${total} mots : ${min} au moins pour ce mail, développe un peu.`);

  failures.push(...familyFailures(family, parts, context));
  failures.push(...validateSubject(parts.subject, context.companyName));
  const arm = context.subjectArm ? subjectArmProblem(parts.subject, context.subjectArm) : null;
  if (arm) failures.push(arm);
  return { ok: failures.length === 0, failures };
}
