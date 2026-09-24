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
  "pas mal de temps",
  "cote startup et cote entreprise",
  "revolutionner",
  "booster",
];

/** Le créneau de 30 minutes est un élément de CTA, pas une donnée chiffrée. */
const CTA_NUMBERS = new Set([30]);

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface ValidationContext {
  facts: DerivedFact[];
  /**
   * Contenu du site du prospect. Les nombres qu'il contient (« 268 points de
   * livraison », « 320 dossiers ») sont VERIFIABLES : les rejeter comme
   * inventes etait un faux positif du validateur.
   */
  siteText?: string;
  contact?: DecisionMakerContact | null;
  tone: ToneKey;
  companyName: string;
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
function lengthBounds(tone: ToneKey): { min: number; max: number } {
  return tone === "bref" ? { min: 40, max: 70 } : { min: 60, max: 110 };
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
  const known = knownNumbers(context.facts);
  if (context.siteText) {
    for (const value of numbersIn(context.siteText)) {
      known.add(value);
      known.add(Math.round(value));
    }
  }
  const invented = numbersIn(body).filter(
    (value) => !known.has(value) && !known.has(Math.round(value)) && !CTA_NUMBERS.has(value),
  );
  if (invented.length) {
    failures.push(
      `Nombre absent des faits : ${[...new Set(invented)].join(", ")}. Tout chiffre doit venir des données collectées.`,
    );
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

  const words = wordCount(body);
  const { min, max } = lengthBounds(context.tone);
  if (words < min || words > max) {
    failures.push(`${words} mots : la cible est ${min}-${max} pour ce registre.`);
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
