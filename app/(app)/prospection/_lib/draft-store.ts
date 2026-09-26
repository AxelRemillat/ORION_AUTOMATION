"use client";

import { createClient } from "@/lib/supabase/client";

type Draft = { subject: string; body: string };

/**
 * Le brouillon d'une génération vit dans `messages` (status « draft ») dès que
 * le job l'a écrit. Les retouches y sont reportées au fil de la frappe : on
 * peut quitter l'écran et retrouver le texte tel qu'on l'a laissé.
 */

/** Brouillon actuel en base, ou null s'il a disparu. */
export async function loadDraft(id: string): Promise<Draft | null> {
  const { data } = await createClient().from("messages").select("subject, body").eq("id", id).maybeSingle();
  if (!data) return null;
  return { subject: data.subject ?? "", body: data.body };
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Écrit la retouche 800 ms après la dernière frappe. Un mail parti n'est jamais modifié. */
export function saveDraftSoon(id: string, draft: Draft): void {
  const previous = pending.get(id);
  if (previous) clearTimeout(previous);
  pending.set(
    id,
    setTimeout(() => {
      pending.delete(id);
      void createClient()
        .from("messages")
        .update({ subject: draft.subject.trim() || null, body: draft.body.trim() })
        .eq("id", id)
        .eq("status", "draft")
        .then(() => undefined, () => undefined);
    }, 800),
  );
}
