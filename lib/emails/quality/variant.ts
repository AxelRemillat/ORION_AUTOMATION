import { deriveVariant, recordMessageVariant } from "@/lib/variants/record";
import type { StrategyBrief } from "@/lib/emails/strategist";
import { DEMO_LINKS } from "./demo-links";
import type { QualityOutcome } from "./generate";

/**
 * Enregistre la VARIANTE d'un brouillon d'intro (une ligne par mail, upsert) :
 * type d'accroche, pain, démo, demande, style d'objet (bras de l'expérience
 * n° 1), premier mot, longueur. Appelé partout où un brouillon est écrit (job,
 * régénération, complétion), pour que la mesure couvre tous les mails.
 */
export const CTA_LABEL = "rdv-15-min";

export async function recordDraftVariant(
  db: unknown,
  input: { messageId: string; userId: string; brief?: Pick<StrategyBrief, "angle" | "pain"> | null; outcome: Pick<QualityOutcome, "subject" | "body" | "demo" | "subjectStyle"> & Partial<Pick<QualityOutcome, "family">> },
): Promise<boolean> {
  const derived = deriveVariant(input.outcome.subject, input.outcome.body);
  const demo = Object.values(DEMO_LINKS).find((link) => link.path === input.outcome.demo)?.key ?? null;
  return recordMessageVariant(db, {
    messageId: input.messageId,
    userId: input.userId,
    hookType: input.brief?.angle.type ?? null,
    pain: input.brief?.pain.task ?? null,
    demo,
    cta: CTA_LABEL,
    ...derived,
    // Le bras de l'expérience, pas la forme lue : c'est lui qu'on compare.
    subjectStyle: input.outcome.subjectStyle,
    family: input.outcome.family ?? null,
  });
}
