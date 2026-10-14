import { concreteDafQuestion } from "./daf";
import { isOpenAIQuotaError } from "@/lib/ai/quota";
import type { AskFn } from "@/lib/ai/chat";
import { ALLOWED_DEMO_URLS, DEMO_HOST } from "./demo-links";
import { bareDemoUrl, F2_INTRO, F4_WHO, FAMILY_LIMITS, FAMILY_PARAM, LEGACY_F2_INTRO, type MailFamily } from "./families";
import { DEMO_OPENING, FORBIDDEN_WORDS, wordHit } from "./rules";
import { countWords } from "./template";

/**
 * JUGE EN CHECK-LIST (Cowork #32) — verdicts BINAIRES, plus de note globale.
 *
 * Une note de 1 à 10 donnée par un modèle était bruitée : 5 verdicts sur 15
 * changeaient d'un passage à l'autre, et le relecteur senior plafonnait à 7-8
 * des mails corrects. Chaque critère est désormais OUI ou NON, avec une
 * citation du mail pour preuve.
 *
 *   - D1 à D5 : contrôles DÉTERMINISTES (code, aucun appel).
 *   - C1 à C5 : critères SÉMANTIQUES, un appel JSON structuré, rejoué
 *     CHECKLIST_SAMPLES fois ; chaque critère est tranché à la MAJORITÉ.
 *
 * « Prêt » = tous les critères à OUI. Note affichée = 10 − pénalités des NON.
 * Le juge de grille et le relecteur senior d'avant ne notent plus : leurs
 * refus réels servent d'exemples aux critères (C5 surtout).
 */

/** Crédit OpenAI épuisé : on le fait SUIVRE (le job s'arrête proprement) ; toute autre panne = lecture illisible. */
const keepQuota = (error: unknown): string => {
  if (isOpenAIQuotaError(error)) throw error;
  return "";
};

export type CriterionId = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "C1" | "C2" | "C3" | "C4" | "C5";

export interface CriterionResult {
  id: CriterionId;
  label: string;
  /** `code` : contrôle déterministe ; `llm` : critère sémantique. */
  kind: "code" | "llm";
  ok: boolean;
  /** Preuve : extrait du mail (ou mesure pour le code). */
  citation: string;
}

export interface ChecklistVerdict {
  items: CriterionResult[];
  ready: boolean;
  /** 10 − pénalités des critères à NON. */
  score: number;
}

export const CRITERIA: Record<CriterionId, { label: string; kind: "code" | "llm"; penalty: number }> = {
  D1: { label: "Longueur de la famille respectée", kind: "code", penalty: 1 },
  D2: { label: "Lien de démo complet et cohérent avec la famille", kind: "code", penalty: 1 },
  D3: { label: "Salutation correcte", kind: "code", penalty: 1 },
  D4: { label: "Un seul appel à l'action (une seule question finale)", kind: "code", penalty: 1 },
  D5: { label: "Aucun mot interdit", kind: "code", penalty: 1 },
  D6: { label: "Aucun groupe nominal ni expression de 3 mots répétés", kind: "code", penalty: 1 },
  D7: { label: "Pas d'ouverture par la démo (fait et problème d'abord)", kind: "code", penalty: 2 },
  C1: { label: "Le fait cité est spécifique et figure dans les faits de la fiche", kind: "llm", penalty: 3 },
  C2: { label: "Le problème découle de ce fait et concerne le rôle du destinataire", kind: "llm", penalty: 2 },
  C3: { label: "Proposition concrète, à la 1re personne, à la voix active", kind: "llm", penalty: 2 },
  C4: { label: "Une phrase de résultat concret pour le client (F4)", kind: "llm", penalty: 2 },
  C5: { label: "Aucune formulation passive, vague ou à double sens", kind: "llm", penalty: 1 },
};

/**
 * Lectures (Cowork #34) : C1 et C5, les critères qui basculaient d'un passage
 * à l'autre, sont tranchés sur CHECKLIST_SAMPLES lectures ; les autres sur les
 * BASE_SAMPLES premières. Un seul appel par lecture (JSON de tous les critères).
 */
export const CHECKLIST_SAMPLES = 5;
export const BASE_SAMPLES = 3;
// Cowork #58 : C2 (problème propre au métier) vote aussi sur toutes les lectures — critère le plus discuté, verdict instable sur 3.
const WIDE: ReadonlySet<CriterionId> = new Set(["C1", "C2", "C5"]);

/** Mots de liaison, et mots trop génériques pour qu'une répétition gêne (« références manquantes » ×2 passe). */
const STOP = new Set(["le", "la", "les", "l", "un", "une", "des", "de", "du", "d", "au", "aux", "à", "a", "et", "ou", "en", "dans", "sur", "pour", "par", "avec", "vos", "votre", "nos", "notre", "leur", "leurs", "ce", "ces", "cette", "qui", "que", "quoi", "je", "j", "vous", "il", "elle", "est", "sont", "se", "s", "ne", "pas", "plus", "chaque", "avant", "après"]);
const GENERIC = new Set(["facture", "factures", "fournisseur", "fournisseurs", "référence", "références", "manquante", "manquantes", "manquant", "manquants", "commande", "commandes", "demande", "demandes", "devis", "information", "informations", "client", "clients", "délai", "délais", "e-mail", "e-mails", "mail", "mails", "réponse", "confirmation", "confirmations", "validation", "reçues", "reçus", "reçue"]);

/** D6 : le même groupe nominal (2 mots pleins consécutifs, dont un non générique) revient. */
export function repeatedNounGroups(text: string): string[] {
  const words = text.toLowerCase().replace(/[’']/g, " ").split(/[^\p{L}\p{N}-]+/u).filter((word) => word && !STOP.has(word));
  const seen = new Map<string, number>();
  for (let index = 0; index + 1 < words.length; index += 1) {
    const pair = [words[index], words[index + 1]];
    if (pair.every((word) => GENERIC.has(word))) continue;
    const key = pair.join(" ");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([key]) => key);
}

/**
 * D6 (Cowork #47, MAISON JUCLA : « avant la clôture » deux fois) : la même expression de 3 mots ou plus revient,
 * mots-outils compris, dans deux phrases ou dans la même. Une expression faite UNIQUEMENT de mots-outils et de noms
 * génériques (« les références manquantes », FIRSTPELLETS prêt selon Cowork) ne compte pas.
 */
export function repeatedExpressions(text: string, size = 3): string[] {
  const seen = new Map<string, number>();
  for (const sentence of text.split(/[.!?;:…]+/)) {
    const words = sentence.toLowerCase().replace(/[’']/g, " ").split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
    for (let index = 0; index + size <= words.length; index += 1) {
      const gram = words.slice(index, index + size);
      if (gram.every((word) => STOP.has(word) || GENERIC.has(word))) continue;
      const key = gram.join(" ");
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return [...seen].filter(([, count]) => count > 1).map(([key]) => key);
}

/** Salutation que le code pose : « Bonjour, » ou « Bonjour Monsieur/Madame <Nom>, ». */
const GREETING_SHAPE = /^Bonjour( (Monsieur|Madame)( [\p{Lu}][\p{L}' -]*)?)?,$/u;

const paragraphs = (core: string) => core.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);

/** D1 à D5 : contrôles déterministes sur le corps assemblé (salutation → demande). */
export function deterministicChecks(core: string, context: { family: MailFamily; greeting: string }): CriterionResult[] {
  const blocks = paragraphs(core);
  const result = (id: CriterionId, ok: boolean, citation: string): CriterionResult => ({ id, label: CRITERIA[id].label, kind: "code", ok, citation });

  const words = countWords(core);
  const { min, max } = FAMILY_LIMITS[context.family];

  const proof = core.split("\n").find((line) => line.includes(DEMO_HOST)) ?? "";
  const url = proof ? proof.slice(proof.indexOf(DEMO_HOST)).trim() : "";
  const bare = bareDemoUrl(url);
  const familyMark = new RegExp(`[?&]v=${FAMILY_PARAM[context.family]}\\b`);
  const demoOk = Boolean(url) && ALLOWED_DEMO_URLS.includes(bare) && bare !== `${DEMO_HOST}/automatisations` && familyMark.test(url);

  const first = blocks[0] ?? "";
  const greetingOk = first === context.greeting.trim() && GREETING_SHAPE.test(first);

  // F3 : la question d'ouverture est le mail lui-même ; seule la demande finale s'y ajoute.
  // La ligne de démo porte un « ? » d'URL (automatisations?demo=…) : elle ne compte pas.
  const counted = (context.family === "F3" ? blocks.filter((_, index) => index !== 1) : blocks).filter((block) => !block.includes(DEMO_HOST));
  const questions = counted.join("\n").match(/\?/g)?.length ?? 0;
  const last = blocks[blocks.length - 1] ?? "";
  const ctaOk = questions === 1 && last.endsWith("?");

  const written = blocks.slice(1).join("\n");
  const forbidden = FORBIDDEN_WORDS.filter((word) => wordHit(written, word));
  // Texte écrit par le rédacteur : sans la salutation, la ligne de démo, les phrases fixes et la demande.
  const own = blocks.slice(1, -1).filter((block) => !block.includes(DEMO_HOST) && block !== F2_INTRO && block !== LEGACY_F2_INTRO && block !== F4_WHO);
  const repeated = [...repeatedNounGroups(own.join(" ")), ...repeatedExpressions(own.join(" \n. "))];
  const opening = own[0] ?? "";

  return [
    result("D1", words >= min && words <= max, `${words} mots (${min} à ${max})`),
    result("D2", demoOk, url || "aucun lien"),
    result("D3", greetingOk, first || "aucune salutation"),
    result("D4", ctaOk, `${questions} question(s) ; fin : « ${last.slice(-80)} »`),
    result("D5", forbidden.length === 0, forbidden.length ? forbidden.join(", ") : "aucun"),
    result("D6", repeated.length === 0, repeated.length ? repeated.join(", ") : "aucune"),
    result("D7", !DEMO_OPENING.test(opening) && !(blocks[1] ?? "").includes(DEMO_HOST), opening.slice(0, 90) || "—"),
  ];
}

/**
 * C5 — refus RÉELS du juge de grille et du relecteur senior (mesures #31) :
 * formulations passives, vagues ou à double sens.
 */
export const C5_NEGATIVES = [
  "« les informations manquantes sont signalées » (DELIMBE) : passif, on ne sait pas qui signale ni à qui.",
  "« quand la ville manque » (FIRSTPELLETS) : tournure lourde et peu naturelle.",
  "« la démo trie une demande » (PARCOME) : « trier » n'est pas un résultat utile pour le client.",
  "« prépare les informations à valider » (TRANSLOCAUTO) : vague, quel résultat concret ?",
  "« pièces administratives » chez un fabricant de pièces mécaniques : mot à double sens dans leur métier.",
  "« prépare son classement dans la catégorie commandes » : résultat sans valeur pour le client.",
] as const;

const SEMANTIC: Exclude<CriterionId, "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7">[] = ["C1", "C2", "C3", "C4", "C5"];

export function semanticCriteria(family: MailFamily): typeof SEMANTIC {
  // F4 n'a pas de phrase « J'automatise… » (la démo parle en preuve) : C4 y remplace C3. C1 et C2 s'y appliquent comme ailleurs.
  return family === "F4" ? SEMANTIC.filter((id) => id !== "C3") : SEMANTIC.filter((id) => id !== "C4");
}

/** Prompt FIGÉ (aucune donnée variable) : les données vont dans le message. */
export function buildChecklistPrompt(): string {
  return `Tu vérifies un mail de prospection à froid écrit par Axel Remillat (indépendant, automatisation et IA pour PME). Tu ne donnes PAS de note : tu réponds OUI (true) ou NON (false) à chaque critère, avec une CITATION EXACTE du mail qui prouve ta réponse (pour un NON : le passage fautif ; s'il manque quelque chose, le passage le plus proche).
La forme (longueur, lien, salutation, demande finale, mots interdits) est vérifiée par un programme : ne la juge pas.

C1 — Le mail s'appuie sur un fait SPÉCIFIQUE à l'entreprise (produit, gamme, clientèle, service, process), présent dans « Faits de la fiche » OU dans « Texte du site ». Compare sur le SENS, jamais à la lettre : un fait reformulé, abrégé ou combiné à partir de ces textes = OUI (« capteurs de front d'onde et miroirs déformables » lu sur le site = OUI). NON si c'est une catégorie générique (« vos demandes de devis », « vos documents clients », « votre secteur ») ou un fait qu'aucun des deux textes ne porte.
   En F4, MÊME EXIGENCE qu'en F1 : un produit, un client, un chiffre ou un process NOMMÉ. Une description du secteur ou du métier (« vous assurez la maintenance et le déploiement de parcs informatiques en France et en Belgique ») = NON (Cowork #35, VSDM). La démo n'est PAS un fait sur elle.
   En F3 : la question doit NOMMER un objet concret propre à l'entreprise (un produit, un type de commande, un document précis) — « documents clients », « vos demandes » = NON.
   TEST DE SUBSTITUTION (Cowork #36, toutes familles) : si la phrase resterait vraie pour 10 concurrents du même métier, C1 = NON. Une ACTIVITÉ (« vous créez et installez des fermetures sur mesure », « stockage et configuration d'équipements pour vos clients »), un FORMULAIRE ou une PAGE du site (« votre espace réservé aux distributeurs », « études via un formulaire dédié ») ne suffisent jamais. Il faut un produit, un client, un chiffre, un lieu ou un process PROPRE à l'entreprise.
   FIDÉLITÉ : un fait reformulé au point de changer son sens = NON (« Qualimat accompagne votre traçabilité » alors que Qualimat est un référentiel).
   OUI : « Votre liste de produits en ligne permet aux crèches de demander un devis personnalisé. » (fait : devis personnalisé à partir d'une liste de produits).
   NON : « Dans le négoce, les commandes arrivent par mail. » (générique).
C2 — (toutes familles, F4 comprise) Un problème est ÉNONCÉ, il DÉCOULE de ce fait précis (un problème générique comme « le client attend une réponse rapide » = NON) (même tâche, même objet) et concerne le rôle du destinataire quand on le connaît (DAF : factures, relances ; commercial : devis, commandes ; service client : demandes reçues). Une situation type de LEUR métier n'a pas à être prouvée.
   L'ÉLÉMENT EN CAUSE DOIT ÊTRE PROPRE À LEUR MÉTIER (Cowork #58) : un document, une référence, un outil, une réglementation ou un client type que l'on ne trouverait pas tel quel chez un autre métier — « revenu fiscal manquant » (bailleur social), « référence cadastrale absente du dossier Liciel » (diagnostiqueur), « n° de chantier RTE/ENEDIS manquant » (réseaux électriques), « cote de fixation absente du plan » (tôlerie). NON s'il reste générique, valable pour n'importe quelle entreprise : « une réponse manquante », « une adresse manquante », « une pièce manquante », « un justificatif manquant », « un document manquant », « une information manquante », « une référence manquante », « une quantité manquante » sans l'objet métier qui la porte (une RÉFÉRENCE NOMMÉE — cadastrale, n° de chantier, référence de pièce de LEUR catalogue — est propre au métier ; « une référence manquante retarde la confirmation » ne l'est pas). Un élément simple RATTACHÉ à un objet métier nommé suffit : « une quantité absente dans les commandes d'assemblages laser » = OUI, « une quantité manquante » seule = NON. Ce test est STRICT : dans le doute, NON.
   Le problème NOMME cet élément ET sa conséquence dans LEUR process. NON : « le client attend votre réponse », « les devis tardent », « peut nécessiter un échange avant de recevoir une réponse », ou un « problème » qui est déjà une proposition (« je peux signaler les éléments manquants »). EN F3, la question est le problème : elle suffit si elle nomme l'élément à vérifier (références, délais, cotes, quantités) sur un objet concret de l'entreprise — la conséquence y reste implicite (« Qui repère les références manquantes dans les commandes de granulés de paille ? » = OUI : l'objet est concret et propre à eux ; « Qui vérifie les éléments nécessaires au devis ? » = NON : « éléments nécessaires » est générique).
   OUI : « Qui repère les cotes manquantes dans les plans de découpe laser avant le devis ? » (fait : analyse des plans et devis sous 48 h).
   NON : un problème sans lien avec le fait cité, ou affirmé comme un défaut constaté chez eux (« vous perdez des commandes »).
   Cas du mail à une AGENCE (famille F5, segment Agences) : le problème est celui de SES CLIENTS, ou sa capacité à produire — « ces clients demandent ensuite des automatisations qu'une équipe de six personnes ne peut pas livrer » est un OUI. Ne le refuse pas au motif qu'il ne décrit pas un défaut de l'agence elle-même.
C3 — (pas en F4) La proposition dit ce que JE fais, à la 1re personne et à la voix active (« J'automatise… », « Je mets en place… »), avec un geste concret lié au problème, et ce qu'ils y gagnent — pas une liste d'étapes (Cowork #58). NON seulement si la phrase aligne TROIS gestes techniques ou plus SANS résultat pour eux (« je lis les tests, je signale les manques et je renseigne votre outil »). OUI dès qu'un geste mène à un résultat visible : « je signale les références manquantes et dirige les demandes complètes vers votre équipe », « je prépare leur saisie et signale les quantités manquantes avant le lancement » = OUI. NON aussi (Cowork #60) si la proposition vise une destination VAGUE — « votre outil », « votre logiciel », « votre système » sans le nommer ni dire ce qu'ils y gagnent — : « J'automatise la lecture des tests d'éligibilité, signale les manques et renseigne votre outil pour établir le devis » = NON (quel outil ? quel gain ? « pour établir le devis » redit la tâche, ce n'est pas un gain).
   OUI : « J'automatise la préparation des devis : je reprends les références et quantités demandées, signale les manques et prépare le chiffrage pour votre validation. »
   NON : « Les demandes sont triées puis une réponse est préparée. » (passif) ; « J'optimise vos processus. » (vague).
C4 — (F4 seulement) Une phrase dit le RÉSULTAT concret que la démo produit pour le client (une facture, un devis, une réponse, une confirmation de délai, une commande fournisseur), puis le transpose honnêtement à leur activité.
   COHÉRENCE : l'objet lu par la démo doit être celui du prospect (il reçoit des demandes d'étude → la démo lit une demande d'étude type, pas « une commande type »). Objet différent = NON.
   OUI : « Elle lit une commande type et prépare la facture à valider ; le même principe s'appliquerait à vos commandes de vêtements professionnels. »
   OUI : « Elle lit une demande de transport type et prépare un brouillon de devis à valider ; le même principe s'appliquerait à vos demandes de transport. » (un devis, une facture, une réponse au client = résultat concret)
   NON : « elle trie une demande » ; « elle prépare les informations à valider » (aucun document ni réponse pour le client).
   Le mot « type » (ou « générique ») est OBLIGATOIRE en F4 : il dit honnêtement que la démo n'a pas été faite sur leurs données. Ne le juge jamais vague.
C5 — Aucune formulation passive, vague, lourde ou à double sens dans leur métier. Refus réels :
${C5_NEGATIVES.map((line) => `   - ${line}`).join("\n")}
   À l'inverse, un acte concret à la voix active est CLAIR, même court : « je signale les références manquantes et prépare une confirmation à valider », « je prépare un devis à vérifier », « je relève les informations reçues, signale les détails manquants et prépare un devis à vérifier », « j'automatise le tri de ces commandes et je signale celles à confirmer » = OUI (Cowork #34-#36 : FIRSTPELLETS, BULLY, DELIMBE prêts). C5 ne juge que la FORME (passif, vague, double sens), jamais la richesse du fait ou du problème.

Réponds UNIQUEMENT en JSON : {"C1":{"ok":true|false,"citation":"…"},"C2":{…},"C3":{…},"C4":{…},"C5":{…}} — C3 sauf en F4, C4 seulement en F4.`;
}

type Sample = Partial<Record<CriterionId, { ok: boolean; citation: string }>>;

export function parseChecklistSample(raw: string): Sample | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const sample: Sample = {};
  for (const id of SEMANTIC) {
    const entry = (value as Record<string, unknown>)[id] as { ok?: unknown; citation?: unknown } | undefined;
    if (entry && typeof entry.ok === "boolean") sample[id] = { ok: entry.ok, citation: typeof entry.citation === "string" ? entry.citation.trim() : "" };
  }
  return Object.keys(sample).length ? sample : null;
}

/**
 * Majorité par critère sur les lectures lisibles ; égalité → NON (prudence).
 * C1 et C5 votent sur toutes les lectures, les autres sur les BASE_SAMPLES premières.
 * `null` si aucune lecture.
 */
export function majority(samples: readonly (Sample | null)[], ids: readonly CriterionId[]): CriterionResult[] | null {
  const read = samples.filter((sample): sample is Sample => Boolean(sample));
  if (!read.length) return null;
  const results: CriterionResult[] = [];
  for (const id of ids) {
    const pool = WIDE.has(id) ? read : read.slice(0, BASE_SAMPLES);
    const votes = pool.map((sample) => sample[id]).filter((vote): vote is { ok: boolean; citation: string } => Boolean(vote));
    if (!votes.length) return null;
    const yes = votes.filter((vote) => vote.ok).length;
    const ok = yes > votes.length - yes;
    const witness = votes.find((vote) => vote.ok === ok && vote.citation) ?? votes.find((vote) => vote.ok === ok);
    results.push({ id, label: CRITERIA[id].label, kind: "llm", ok, citation: witness?.citation ?? "" });
  }
  return results;
}

export function scoreOf(items: readonly CriterionResult[]): number {
  return Math.max(0, 10 - items.filter((item) => !item.ok).reduce((sum, item) => sum + CRITERIA[item.id].penalty, 0));
}

export function verdictOf(items: CriterionResult[]): ChecklistVerdict {
  return { items, ready: items.every((item) => item.ok), score: scoreOf(items) };
}

export interface ChecklistInput {
  subject: string;
  /** Corps assemblé (salutation → demande). */
  core: string;
  family: MailFamily;
  greeting: string;
  company: string;
  /** Faits de la fiche : key_figures.facts s'ils existent, sinon ce que l'on sait d'elle. */
  facts: string;
  recipientRole?: string | null;
  /** Texte du site déjà extrait (profil métier, signaux) : C1 y cherche le fait, sur le sens. */
  siteText?: string | null;
  /** Douleur DAF / RAF (Cowork #46) : une question F3 concrète du rapprochement passe C1 sans fait d'entreprise. */
  daf?: boolean;
}

/**
 * Check-list complète. Les critères sémantiques ne sont demandés que si les
 * contrôles du code passent : inutile de payer pour un mail déjà refusé.
 * `null` = relecture indisponible (aucune lecture lisible : quota, réseau).
 */
export async function judgeChecklist(ask: AskFn, input: ChecklistInput, operation = "qualite:checklist", samples = CHECKLIST_SAMPLES): Promise<ChecklistVerdict | null> {
  const code = deterministicChecks(input.core, { family: input.family, greeting: input.greeting });
  if (code.some((item) => !item.ok)) return verdictOf(code);
  const user = `Famille : ${input.family}\nEntreprise : ${input.company}\nDestinataire : ${input.recipientRole?.trim() || "rôle inconnu"}\nFaits de la fiche :\n${input.facts || "- (aucun)"}\nTexte du site (extrait) :\n${(input.siteText ?? "").slice(0, 3000) || "(aucun)"}\n\nMAIL\nObjet : ${input.subject}\n\n${input.core}`;
  const read = (index: number) => ask("judge", buildChecklistPrompt(), user, 0, index ? `${operation}:lecture-${index + 1}` : operation).catch(keepQuota);
  const total = Math.max(1, samples);
  const first = Math.min(BASE_SAMPLES, total);
  const parsed = (await Promise.all(Array.from({ length: first }, (_, index) => read(index)))).map(parseChecklistSample);
  // Arrêt anticipé (Cowork #38) : si les BASE_SAMPLES premières lectures sont toutes lisibles et UNANIMES sur
  // C1 et C5, les lectures suivantes ne peuvent plus renverser la majorité sur CHECKLIST_SAMPLES : verdict
  // identique, 2 appels économisés.
  if (total > first && !unanimousOnWide(parsed, first, semanticCriteria(input.family))) {
    parsed.push(...(await Promise.all(Array.from({ length: total - first }, (_, index) => read(first + index)))).map(parseChecklistSample));
  }
  const semantic = majority(parsed, semanticCriteria(input.family));
  if (!semantic) return null;
  // Cowork #46 : en F3 DAF, la question qui nomme l'objet concret du rapprochement EST le fait (règle F3 de #36).
  // Cowork #47 : mêmes conditions pour C2 — le rôle DAF rattache ce problème au destinataire.
  const question = input.core.replace(/\r\n/g, "\n").split(/\n\s*\n/)[1] ?? "";
  if (input.daf && input.family === "F3" && concreteDafQuestion(question)) {
    for (const item of semantic) {
      if ((item.id === "C1" || item.id === "C2") && !item.ok) Object.assign(item, { ok: true, citation: `question DAF concrète (règle F3, #46/#47) : « ${question} »` });
    }
  }
  return verdictOf([...code, ...semantic]);
}

/** Les lectures de base suffisent : toutes lisibles, et unanimes sur chaque critère tranché sur toutes les lectures (C1, C5). */
export function unanimousOnWide(samples: readonly (Sample | null)[], expected: number, ids: readonly CriterionId[]): boolean {
  const read = samples.filter((sample): sample is Sample => Boolean(sample));
  if (read.length < expected) return false;
  return ids
    .filter((id) => WIDE.has(id))
    .every((id) => {
      const votes = read.map((sample) => sample[id]?.ok);
      return votes.every((vote) => vote !== undefined) && new Set(votes).size === 1;
    });
}

/** Réécriture CIBLÉE : seuls les critères à NON, avec leur citation. */
export function checklistFeedback(verdict: ChecklistVerdict): string {
  return verdict.items
    .filter((item) => !item.ok)
    .map((item) => `- ${item.id} NON — ${item.label}${item.citation ? ` : « ${item.citation} »` : ""}`)
    .join("\n");
}

/** Raison « À revoir » en une ligne : le premier critère à NON. */
export function checklistReason(verdict: ChecklistVerdict): string {
  const failed = verdict.items.filter((item) => !item.ok);
  if (!failed.length) return "";
  const first = failed[0];
  return `${failed.length} critère(s) à NON — ${first.id} ${first.label}${first.citation ? ` : « ${first.citation} »` : ""}`;
}
