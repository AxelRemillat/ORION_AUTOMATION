import type { OppositionCheck } from "@/lib/enrichment/opposition";
import { recordProspectEvent } from "@/lib/history/record";
import type { Db } from "@/lib/trash/scope";
import type { Prospect, ProspectStatus } from "@/types";
import { oppositionVerified } from "./follow-up-policy";

/**
 * Vérification d'opposition des prospects DÉJÀ CONTACTÉS dont une relance est
 * possible (contacté, relance 1, relance 2), avant que la relance ne soit
 * rédigée ou programmée. 04/10/2026 : ARTFLEX et BOUVET CARTIER avaient une
 * relance prévue sans vérification — BOUVET était opposée.
 *
 * INPI d'abord (gratuit), Pappers en repli dans son plafond du jour. Le
 * résultat est écrit sur la fiche ET dans son historique. Aucune source : la
 * fiche est marquée « non vérifiée » (opposition_checked: false), la relance
 * reste bloquée, et on réessaie au run suivant.
 */
const FOLLOW_UP_STATUSES: ProspectStatus[] = ["contacte", "relance_1", "relance_2"];

export async function verifyFollowUpOppositions(
  db: Db,
  userId: string,
  input: { verify: (siren: string) => Promise<OppositionCheck>; limit: number; deadline: number; now?: Date },
): Promise<{ checked: number; opposed: number; failed: number }> {
  const { data } = await db
    .from("prospects")
    .select("*")
    .eq("user_id", userId)
    .in("status", FOLLOW_UP_STATUSES)
    .is("deleted_at", null);
  const pending = ((data ?? []) as Prospect[]).filter(
    (prospect) => !prospect.do_not_contact && prospect.siren && !oppositionVerified(prospect.key_figures as Record<string, unknown>),
  );

  const report = { checked: 0, opposed: 0, failed: 0 };
  for (const prospect of pending.slice(0, input.limit)) {
    if (Date.now() > input.deadline) break;
    const check = await input.verify(prospect.siren as string).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "erreur",
    }));
    const at = (input.now ?? new Date()).toISOString();
    const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
    const next = check.ok
      ? { ...figures, opposition_checked: true, opposition_source: check.source, opposition_checked_at: at, ...(check.refuses ? { refuses_prospecting: true } : {}) }
      : { ...figures, opposition_checked: false };
    await db.from("prospects").update({ key_figures: next }).eq("id", prospect.id).eq("user_id", userId);
    if (check.ok) {
      await recordProspectEvent(db, { prospectId: prospect.id, userId, kind: "opposition", at, data: { refuses: check.refuses, source: check.source } });
    }
    report.checked += 1;
    if (!check.ok) report.failed += 1;
    else if (check.refuses) report.opposed += 1;
  }
  return report;
}
