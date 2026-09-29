import { dedupeGreeting, greetingCount } from "./greeting";
import { hasOptOut, withOptOut } from "./opt-out";
import { recipientError } from "./recipient";
import { extractSubjectLine, normalizeSubject, SUBJECT_MAX, subjectLineIndex } from "./subject";
import { bodyWordCount, MAX_BODY_WORDS } from "./words";

/**
 * CONTRÔLE AVANT ENVOI — pur, sans réseau, BLOQUANT.
 *
 * Appelé à la validation du brouillon, à la programmation, au départ réel
 * (tick) et pour les relances. Les 4 premiers mails (28/09) sont partis avec
 * une double salutation, un objet collé dans le corps et des objets
 * incohérents : chacune de ces erreurs est désormais une règle.
 *
 * Le jugement « objet cohérent avec le corps » (LLM) n'est PAS calculé ici : il
 * est passé en entrée (`coherence`), et ne produit qu'un avertissement.
 */

export type RuleId =
  | "greeting"
  | "subject-line"
  | "words"
  | "placeholders"
  | "recipient"
  | "signature"
  | "subject-format"
  | "subject-coherence"
  | "subject-review"
  | "opt-out";

export type FixId = "dedupe-greeting" | "move-subject" | "normalize-subject" | "add-opt-out";

export interface PreflightCheck {
  rule: RuleId;
  label: string;
  status: "ok" | "warning" | "error";
  message: string | null;
  fix?: FixId;
}

export interface PreflightFix {
  id: FixId;
  label: string;
}

export interface PreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  fixes: PreflightFix[];
  checks: PreflightCheck[];
  /** Mots du corps hors signature : le nombre que l'écran affiche. */
  words: number;
}

export interface PreflightInput {
  subject: string | null | undefined;
  body: string;
  to: string | null | undefined;
  /** Signature posée par le code (lib/offer/model.ts `signatureFor`). */
  signature?: string | null;
  /** Adresses trouvées pour ce prospect, avec une source (fiche, enrichissement). */
  knownAddresses?: readonly (string | null | undefined)[];
  website?: string | null;
  /** `false` : le corps a changé depuis la dernière relecture de l'objet. */
  subjectReviewed?: boolean;
  /** Verdict LLM (mis en cache), quand il a été demandé. */
  coherence?: { coherent: boolean; reason: string } | null;
  /**
   * `reponse` : réponse à un mail reçu (Cockpit). La conversation est lancée :
   * ni plafond de mots ni signature imposée ; le reste s'applique.
   */
  kind?: "prospection" | "reponse";
  /** `false` à la validation du brouillon : le destinataire se choisit à l'envoi. */
  checkRecipient?: boolean;
}

const FIX_LABELS: Record<FixId, string> = {
  "dedupe-greeting": "Retirer la salutation en double",
  "move-subject": "Déplacer la ligne « Objet » dans l'objet",
  "normalize-subject": "Corriger l'objet (majuscule, point final)",
  "add-opt-out": "Ajouter la mention d'opposition",
};

const PLACEHOLDERS: [RegExp, string][] = [
  [/\[[^\]\n]*\]/, "crochets [ ]"],
  [/\{\{[^}\n]*\}\}/, "accolades {{ }}"],
  [/\bXXX+\b/, "« XXX »"],
  [/à compl[ée]ter/i, "« à compléter »"],
  [/adresse à confirmer/i, "« adresse à confirmer »"],
];

function signatureProblem(body: string, signature?: string | null): string | null {
  const name = signature?.split(/\r?\n/)[0]?.trim() || null;
  const lines = body.trimEnd().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (name) {
    const occurrences = body.split(name).length - 1;
    if (occurrences > 1) return `Signature en double (« ${name} » apparaît ${occurrences} fois).`;
    const firstName = name.split(/\s+/)[0];
    if (occurrences === 0 && last.replace(/[.,]$/, "") !== firstName) return "Signature absente en fin de mail.";
    return null;
  }
  // Sans signature connue : la dernière ligne doit ressembler à un nom.
  return last.split(/\s+/).length <= 4 && !/[?]$/.test(last) ? null : "Signature absente en fin de mail.";
}

export function preflight(input: PreflightInput): PreflightResult {
  const subject = input.subject ?? "";
  const body = input.body ?? "";
  const checks: PreflightCheck[] = [];
  const add = (rule: RuleId, label: string, problem: string | null, level: "error" | "warning" = "error", fix?: FixId) =>
    checks.push({ rule, label, status: problem ? level : "ok", message: problem, ...(problem && fix ? { fix } : {}) });

  const greetings = greetingCount(body);
  add("greeting", "Une seule salutation", greetings > 1 ? `${greetings} salutations en tête du mail.` : null, "error", "dedupe-greeting");

  add(
    "subject-line",
    "Pas de ligne « Objet : » dans le corps",
    subjectLineIndex(body) >= 0 ? "Le corps contient une ligne « Objet : » : elle partirait telle quelle." : null,
    "error",
    "move-subject",
  );

  const prospection = input.kind !== "reponse";
  const words = prospection ? bodyWordCount(body, input.signature) : 0;
  add("words", `${MAX_BODY_WORDS} mots au plus`, words > MAX_BODY_WORDS ? `${words} mots hors signature (plafond ${MAX_BODY_WORDS}).` : null);

  const found = PLACEHOLDERS.filter(([pattern]) => pattern.test(`${subject}\n${body}`)).map(([, label]) => label);
  add("placeholders", "Aucun texte à remplir", found.length ? `Reste à remplir : ${found.join(", ")}.` : null);

  if (input.checkRecipient !== false) {
    add("recipient", "Destinataire vérifié", recipientError(input.to, input.knownAddresses, input.website));
  }
  if (prospection) add("signature", "Signature présente, une fois", signatureProblem(body, input.signature));
  // Mention d'opposition : bloquante sur un mail de prospection, sans objet sur
  // une réponse à quelqu'un qui vient de nous écrire.
  if (prospection) {
    add(
      "opt-out",
      "Mention d'opposition présente",
      hasOptOut(body) ? null : "Aucun moyen de refus : ajoutez la phrase « stop » avant la signature.",
      "error",
      "add-opt-out",
    );
  }

  const normalized = normalizeSubject(subject);
  const format = !subject.trim()
    ? "Objet vide."
    : normalized.length > SUBJECT_MAX
      ? `Objet trop long (${normalized.length} caractères, ${SUBJECT_MAX} au plus).`
      : normalized !== subject
        ? "Objet à corriger : majuscule initiale, sans point final."
        : null;
  add("subject-format", "Objet propre", format, subject.trim() ? "warning" : "error", normalized !== subject && subject.trim() ? "normalize-subject" : undefined);

  add(
    "subject-coherence",
    "Objet cohérent avec le corps",
    input.coherence && !input.coherence.coherent ? `Objet peut-être incohérent : ${input.coherence.reason}` : null,
    "warning",
  );
  add(
    "subject-review",
    "Objet relu après la dernière modification du corps",
    input.subjectReviewed === false ? "Le corps a changé depuis : relisez ou confirmez l'objet." : null,
    "warning",
  );

  const errors = checks.filter((check) => check.status === "error").map((check) => check.message as string);
  const warnings = checks.filter((check) => check.status === "warning").map((check) => check.message as string);
  const fixes = [...new Set(checks.map((check) => check.fix).filter((fix): fix is FixId => Boolean(fix)))].map((id) => ({
    id,
    label: FIX_LABELS[id],
  }));
  return { ok: errors.length === 0, errors, warnings, fixes, checks, words: bodyWordCount(body, input.signature) };
}

/**
 * Applique une correction en un clic. Pur : l'écran enregistre le résultat.
 * `signature` (quand l'écran la connaît) place la phrase d'opposition juste
 * avant elle ; sinon elle est reconnue à sa forme (lib/mail-preflight/opt-out.ts).
 */
export function applyFix(
  id: FixId,
  draft: { subject: string; body: string },
  signature?: string | null,
): { subject: string; body: string } {
  if (id === "add-opt-out") return { ...draft, body: withOptOut(draft.body, signature) };
  if (id === "dedupe-greeting") return { ...draft, body: dedupeGreeting(draft.body) };
  if (id === "normalize-subject") return { ...draft, subject: normalizeSubject(draft.subject) };
  const moved = extractSubjectLine(draft.body);
  return { subject: moved.subject ?? normalizeSubject(draft.subject), body: moved.body };
}

/**
 * Nettoyage d'office d'un brouillon (génération, collage) : ligne « Objet : »
 * sortie du corps, salutation dédoublonnée, objet normalisé. `movedSubject`
 * dit si une ligne « Objet » a été déplacée (toast « objet déplacé »).
 * L'objet déjà rempli est gardé ; la ligne extraite ne le remplace que s'il est vide.
 */
export function cleanDraft(draft: { subject: string; body: string }): { subject: string; body: string; movedSubject: boolean } {
  const moved = extractSubjectLine(draft.body);
  const subject = draft.subject.trim() ? draft.subject : moved.subject ?? "";
  return { subject: normalizeSubject(subject), body: dedupeGreeting(moved.body), movedSubject: moved.subject !== null };
}

/** Résumé d'une ligne, pour `send_error` quand le tick bloque un mail. */
export const blockReason = (result: PreflightResult) => `Contrôle avant envoi : ${result.errors.join(" ")}`;

export { applyGreeting, dedupeGreeting, greetingCount, hasGreeting } from "./greeting";
export { extractSubjectLine, normalizeSubject, SUBJECT_MAX } from "./subject";
export { bodyWordCount, exceedsWordLimit, MAX_BODY_WORDS } from "./words";
export { OPT_OUT_SENTENCE, hasOptOut, withOptOut, withoutOptOut } from "./opt-out";
export { guessedAddress, isEmail, recipientError } from "./recipient";
