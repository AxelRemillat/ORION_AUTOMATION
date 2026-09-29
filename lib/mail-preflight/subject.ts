/**
 * OBJET — majuscule initiale, 60 caractères au plus, pas de point final.
 *
 * Constaté le 28/09 : trois objets en minuscule, et HUMAN SIGHT parti avec
 * « Objet : automatisations sur vos missions SIRH » en PREMIÈRE LIGNE du corps.
 */

export const SUBJECT_MAX = 60;

const RE_PREFIX = /^((?:re|tr|fwd?)\s*:\s*)+/i;

/** Majuscule initiale (après un éventuel « Re: »), espaces resserrés, sans point final. */
export function normalizeSubject(subject: string): string {
  const clean = subject.replace(/\s+/g, " ").trim().replace(/\.+$/, "").trim();
  const prefix = clean.match(RE_PREFIX)?.[0] ?? "";
  const rest = clean.slice(prefix.length);
  const capital = rest.replace(/^(\P{L}*)(\p{L})/u, (_, lead: string, letter: string) => lead + letter.toUpperCase());
  return prefix + capital;
}

/** Ligne « Objet : … » ou « Subject: … » dans le corps. */
const SUBJECT_LINE = /^\s*(objet|subject)\s*:\s*(.*)$/i;

export const subjectLineIndex = (body: string) => body.split(/\r?\n/).findIndex((line) => SUBJECT_LINE.test(line));

/**
 * Extrait une ligne « Objet : … » du corps. Rend le corps sans elle (ni la
 * ligne vide qui la suivait) et l'objet trouvé, ou `null` s'il n'y en a pas.
 */
export function extractSubjectLine(body: string): { subject: string | null; body: string } {
  const lines = body.split(/\r?\n/);
  const index = lines.findIndex((line) => SUBJECT_LINE.test(line));
  if (index < 0) return { subject: null, body };
  const subject = (lines[index].match(SUBJECT_LINE)?.[2] ?? "").trim();
  lines.splice(index, lines[index + 1]?.trim() ? 1 : 2);
  return { subject: subject ? normalizeSubject(subject) : null, body: lines.join("\n").replace(/^\s*\n/, "") };
}
