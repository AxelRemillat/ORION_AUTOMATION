/**
 * Écriture d'un événement d'historique (`prospect_events`). Règle : l'historique
 * ne doit JAMAIS faire échouer l'action qu'il raconte — toute erreur est avalée
 * (table absente avant migration, RLS, réseau).
 *
 * `channel` + `kind` génériques : « orion » aujourd'hui ; « linkedin », « malt »
 * plus tard, sans changer ce module.
 */

export type EventChannel = "orion" | "email" | "linkedin" | "malt" | (string & {});
export type EventKind = "status" | "dnc" | "opposition" | "note" | (string & {});

type Writer = { from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }> } };

export async function recordProspectEvent(
  db: unknown,
  event: {
    prospectId: string;
    kind: EventKind;
    channel?: EventChannel;
    data?: Record<string, unknown>;
    at?: string;
    /** Obligatoire hors session (service_role) : `auth.uid()` y est nul. */
    userId?: string;
  },
): Promise<boolean> {
  try {
    const { error } = await (db as Writer).from("prospect_events").insert({
      prospect_id: event.prospectId,
      kind: event.kind,
      channel: event.channel ?? "orion",
      data: event.data ?? {},
      ...(event.at ? { at: event.at } : {}),
      ...(event.userId ? { user_id: event.userId } : {}),
    });
    return !error;
  } catch {
    return false;
  }
}
