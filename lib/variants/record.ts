/**
 * Variantes d'un mail — À BRANCHER DANS LE GÉNÉRATEUR (agent 2).
 *
 * Usage, juste après l'enregistrement du brouillon d'intro :
 *
 *   import { recordMessageVariant, deriveVariant } from "@/lib/variants/record";
 *
 *   await recordMessageVariant(ctx.db, {
 *     messageId,                      // id du brouillon (messages.id)
 *     userId: ctx.userId,             // obligatoire hors session (tick, service_role)
 *     hookType: brief.angle.type,     // « recrutement », « groupe », « signal », « métier »…
 *     pain: brief.pain.task,          // pain retenu, en clair
 *     demo: proof.demo?.key ?? null,  // démo citée (« factures », « emails »…), null si aucune
 *     cta: "rdv-15-min",              // appel à l'action (libellé court et stable)
 *     ...deriveVariant(email.subject, email.body), // subjectStyle, openingWord, length
 *   });
 *
 * Une ligne par mail (upsert sur message_id) : régénérer un brouillon remplace
 * sa variante. Ne lève jamais — mesurer ne doit pas casser la rédaction.
 * Les taux par valeur sont calculés dans Réglages › Données (lib/variants/stats.ts).
 */

export interface MessageVariant {
  messageId: string;
  userId?: string;
  hookType?: string | null;
  pain?: string | null;
  demo?: string | null;
  cta?: string | null;
  subjectStyle?: string | null;
  openingWord?: string | null;
  length?: number | null;
  /** Famille du mail (expérience n° 2 : F1 à F4). */
  family?: string | null;
}

type Writer = { from: (table: string) => { upsert: (row: Record<string, unknown>, options: { onConflict: string }) => PromiseLike<{ error: unknown }> } };

const clean = (value: string | null | undefined, max = 80) => (value ? value.trim().slice(0, max) || null : null);

export async function recordMessageVariant(db: unknown, variant: MessageVariant): Promise<boolean> {
  try {
    const { error } = await (db as Writer).from("message_variants").upsert(
      {
        message_id: variant.messageId,
        hook_type: clean(variant.hookType),
        pain: clean(variant.pain, 120),
        demo: clean(variant.demo),
        cta: clean(variant.cta),
        subject_style: clean(variant.subjectStyle),
        opening_word: clean(variant.openingWord, 40),
        length: variant.length ?? null,
        ...(variant.family ? { family: clean(variant.family, 8) } : {}),
        ...(variant.userId ? { user_id: variant.userId } : {}),
      },
      { onConflict: "message_id" },
    );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Attributs calculables du texte lui-même : style d'objet, premier mot du
 * corps (après « Bonjour … , »), longueur en mots (hors signature et mention « stop »).
 */
export function deriveVariant(subject: string | null | undefined, body: string | null | undefined): Pick<MessageVariant, "subjectStyle" | "openingWord" | "length"> {
  const title = (subject ?? "").trim();
  const subjectStyle = !title
    ? "sans objet"
    : title.endsWith("?")
      ? "question"
      : /\d/.test(title)
        ? "chiffre"
        : title.split(/\s+/).length <= 4
          ? "court"
          : "phrase";
  const lines = (body ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const start = /^(bonjour|madame|monsieur|hello)\b/i.test(lines[0] ?? "") ? 1 : 0;
  const content = lines.slice(start).filter((line) => !/« ?stop ?»|un simple « stop »/i.test(line));
  const openingWord = (content[0] ?? "").split(/[\s,.;:!?'’]+/).find(Boolean)?.toLowerCase() ?? null;
  // La signature (dernière ligne courte) ne compte pas.
  const words = content.slice(0, content.length > 1 ? -1 : undefined).join(" ").split(/\s+/).filter(Boolean).length;
  return { subjectStyle, openingWord, length: words || null };
}
