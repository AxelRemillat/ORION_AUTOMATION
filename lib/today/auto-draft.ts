import { createJob } from "@/lib/jobs/store";
import type { Db } from "@/lib/trash/scope";
import { flatten } from "./group";
import { loadToday } from "./load";
import { needsIntroDraft } from "./tags";

/**
 * FICHE COMPLÉTÉE → BROUILLON, SANS CLIC.
 *
 * Dès qu'une fiche n'a plus d'étiquette bloquante (email saisi ou trouvé, site
 * corrigé, opposition vérifiée), le brouillon d'intro est lancé : le job relit
 * le site (profil métier) puis rédige, et la fiche remonte dans « Nouveaux
 * prospects ». Même règle que la préparation du matin (`needsIntroDraft`).
 *
 * Rien n'est envoyé : le brouillon attend la relecture dans « Aujourd'hui ».
 */
export type AutoDraftOutcome = "lancé" | "pas prête" | "déjà en cours";

export async function draftIfReady(
  db: Db,
  userId: string,
  prospectId: string,
  options: { now?: Date; enqueue?: typeof createJob } = {},
): Promise<AutoDraftOutcome> {
  const items = flatten((await loadToday(db as never, userId, options.now)).groups);
  const item = items.find((entry) => entry.prospectId === prospectId && entry.messageType === "intro");
  if (!item) return "pas prête";
  if (item.draftPending) return "déjà en cours";
  if (!needsIntroDraft(item)) return "pas prête";
  const created = await (options.enqueue ?? createJob)(
    db,
    {
      type: "email_generate",
      target: { prospectId, label: `Mail ${item.companyName}` },
      params: { prospectId, mode: "full", saveDraft: true, storedContact: true },
    },
    userId,
  );
  return "id" in created ? "lancé" : "pas prête";
}
