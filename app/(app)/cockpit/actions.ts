"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tomorrowMorning } from "./_lib/queue";

/** Résultat uniforme : les composants clients en font un toast. */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Enregistre une décision sur une action de la file.
 *
 * Upsert sur `(user_id, action_id)` : une action ne porte qu'une décision
 * courante. Reporter une action déjà reportée ne crée pas de doublon, elle
 * repousse simplement l'échéance.
 */
async function setState(
  actionId: string,
  state: "done" | "snoozed",
  snoozeUntil: string | null,
): Promise<ActionResult> {
  if (!actionId.trim()) return { ok: false, error: "Action inconnue." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const { error } = await supabase
    .from("action_states")
    .upsert(
      { user_id: user.id, action_id: actionId, state, snooze_until: snoozeUntil },
      { onConflict: "user_id,action_id" },
    );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/cockpit");
  return { ok: true };
}

/** « Fait » — l'action sort de la file définitivement. */
export async function markActionDone(actionId: string): Promise<ActionResult> {
  return setState(actionId, "done", null);
}

/**
 * « Reporter à demain » — l'action est masquée jusqu'au lendemain matin, puis
 * revient d'elle-même en tête de file si elle est toujours pertinente.
 */
export async function snoozeAction(actionId: string): Promise<ActionResult> {
  return setState(actionId, "snoozed", tomorrowMorning().toISOString());
}
