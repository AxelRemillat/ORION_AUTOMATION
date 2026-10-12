import type { OppositionCheck } from "@/lib/enrichment/opposition";
import type { Db } from "@/lib/trash/scope";
import type { Prospect } from "@/types";
import { readAllResult } from "@/lib/supabase/read-all";

/**
 * OPPOSITION À LA PROSPECTION des fiches de « Aujourd'hui ».
 *
 * 02/10/2026 : ADJUVOO, opposée au registre (INPI), apparaissait dans « À
 * compléter » — sa fiche datait d'avant la lecture du registre, rien n'y
 * disait l'opposition. Règle : une fiche n'est « vérifiée » que si Pappers l'a
 * lue, ou si l'opposition a été vérifiée (Pappers, INPI, à la main). Sinon :
 * étiquette « Opposition non vérifiée » (bloquante), et la préparation la
 * vérifie avant tout le reste.
 */

type Figures = Record<string, unknown> | null | undefined;

/** L'opposition de cette fiche est-elle connue ? */
export function oppositionKnown(figures: Figures): boolean {
  const facts = figures ?? {};
  return facts.pappers_read === true || facts.opposition_checked === true || facts.refuses_prospecting === true;
}

/**
 * Rattrapage : vérifie les fiches en attente d'intro (statut « nouveau » ou « à
 * contacter », jamais contactées) dont l'opposition n'est pas connue. Écrit le
 * résultat sur la fiche : opposée → `refuses_prospecting` (elle sort de la
 * file) ; aucune source → `opposition_checked: false` (programmation bloquée).
 */
export async function verifyQueueOppositions(
  db: Db,
  userId: string,
  input: { verify: (siren: string) => Promise<OppositionCheck>; limit: number; deadline: number; now?: Date },
): Promise<{ checked: number; opposed: number; failed: number }> {
  // Toute la file (Cowork #24) : au-delà de 1 000 prospects, les suivants n'étaient jamais vérifiés.
  const { data } = await readAllResult(() => db.from("prospects").select("*").eq("user_id", userId).in("status", ["nouveau", "a_contacter"]).is("deleted_at", null).order("id"));
  const pending = ((data ?? []) as Prospect[]).filter(
    (prospect) => !prospect.do_not_contact && prospect.siren && !oppositionKnown(prospect.key_figures),
  );

  const report = { checked: 0, opposed: 0, failed: 0 };
  for (const prospect of pending.slice(0, input.limit)) {
    if (Date.now() > input.deadline) break;
    const check = await input.verify(prospect.siren as string).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "erreur",
    }));
    const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
    const next = check.ok
      ? {
          ...figures,
          opposition_checked: true,
          opposition_source: check.source,
          ...(check.refuses ? { refuses_prospecting: true } : {}),
        }
      : { ...figures, opposition_checked: false };
    await db.from("prospects").update({ key_figures: next }).eq("id", prospect.id).eq("user_id", userId);
    report.checked += 1;
    if (!check.ok) report.failed += 1;
    else if (check.refuses) report.opposed += 1;
  }
  return report;
}
