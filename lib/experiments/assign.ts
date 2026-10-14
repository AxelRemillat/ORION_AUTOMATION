import { parseVariants, pickVariant, type ExperimentVariant, type MailExperiment } from "./model";

/**
 * ATTRIBUTION D'UNE VARIANTE au moment de la rédaction (Cowork #30).
 *
 *   - Brouillon déjà rédigé (régénération, brouillon validé ou programmé) : il
 *     garde SA variante — ou aucune s'il est né hors expérience. Jamais de
 *     changement.
 *   - Nouveau brouillon : une variante tirée au hasard, équilibrée, SEULEMENT
 *     si une expérience est active.
 *   - Pas d'expérience active, table absente, erreur de lecture : `null`, et la
 *     rédaction se fait exactement comme avant.
 */
type Loose = { from: (table: string) => any };

export interface DraftVariant {
  experimentId: string;
  variant: ExperimentVariant;
  /** Variante déjà posée sur ce brouillon (rien à enregistrer). */
  existing: boolean;
}

const asExperiment = (row: Record<string, unknown> | null): MailExperiment | null => {
  const variants = parseVariants(row?.variants);
  if (!row || !variants) return null;
  return { id: String(row.id), name: String(row.name ?? ""), variants, active: Boolean(row.active), started_at: (row.started_at as string | null) ?? null };
};

export async function activeExperiment(db: unknown, userId: string): Promise<MailExperiment | null> {
  try {
    const { data } = await (db as Loose).from("mail_experiments").select("id, name, variants, active, started_at").eq("user_id", userId).eq("active", true).limit(1);
    return asExperiment(((data ?? []) as Record<string, unknown>[])[0] ?? null);
  } catch {
    return null;
  }
}

/** Variante d'un brouillon existant, avec la phrase de son expérience (active ou non). */
async function assignedVariant(db: Loose, messageId: string): Promise<DraftVariant | null> {
  const { data } = await db.from("mail_experiment_assignments").select("experiment_id, variant").eq("message_id", messageId).maybeSingle();
  const row = data as { experiment_id: string; variant: string } | null;
  if (!row) return null;
  const { data: experiment } = await db.from("mail_experiments").select("id, name, variants, active, started_at").eq("id", row.experiment_id).maybeSingle();
  const variant = asExperiment(experiment as Record<string, unknown> | null)?.variants.find((item) => item.key === row.variant);
  return variant ? { experimentId: row.experiment_id, variant, existing: true } : null;
}

/**
 * La variante du brouillon à écrire. `existingMessageId` : le brouillon que la
 * génération va réécrire (null = nouveau brouillon).
 */
export async function variantForDraft(
  db: unknown,
  input: { userId: string; existingMessageId: string | null; random?: () => number },
): Promise<DraftVariant | null> {
  try {
    const loose = db as Loose;
    // Un brouillon déjà rédigé ne change jamais de variante, ni n'en reçoit une.
    if (input.existingMessageId) return await assignedVariant(loose, input.existingMessageId);
    const experiment = await activeExperiment(db, input.userId);
    if (!experiment) return null;
    const { data } = await loose.from("mail_experiment_assignments").select("variant").eq("experiment_id", experiment.id);
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as { variant: string }[]) counts[row.variant] = (counts[row.variant] ?? 0) + 1;
    return { experimentId: experiment.id, variant: pickVariant(experiment.variants, counts, input.random), existing: false };
  } catch {
    return null;
  }
}

/** Pose la variante d'un NOUVEAU brouillon. Insertion seule : une variante posée ne bouge plus. Ne lève jamais. */
export async function recordAssignment(db: unknown, input: { messageId: string; userId: string; draft: DraftVariant | null }): Promise<boolean> {
  if (!input.draft || input.draft.existing) return false;
  try {
    const { error } = await (db as Loose)
      .from("mail_experiment_assignments")
      .insert({ message_id: input.messageId, user_id: input.userId, experiment_id: input.draft.experimentId, variant: input.draft.variant.key });
    return !error;
  } catch {
    return false;
  }
}
