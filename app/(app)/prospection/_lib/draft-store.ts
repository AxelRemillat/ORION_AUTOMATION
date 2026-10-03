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
  const { data } = await createClient().from("messages")
    .select("subject, body")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  return { subject: data.subject ?? "", body: data.body };
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Écrit la retouche 800 ms après la dernière frappe. Un mail parti n'est jamais modifié.
 * La retouche marque le brouillon « modifié à la main » : aucune régénération
 * automatique ne l'écrasera plus. Si la colonne manque encore (migration pas
 * encore passée), la retouche est écrite sans le drapeau plutôt que perdue.
 */
export function saveDraftSoon(id: string, draft: Draft): void {
  const previous = pending.get(id);
  if (previous) clearTimeout(previous);
  pending.set(
    id,
    setTimeout(() => {
      pending.delete(id);
      const content = { subject: draft.subject.trim() || null, body: draft.body.trim() };
      const write = (patch: typeof content & { edited_by_hand?: boolean }) =>
        createClient().from("messages").update(patch).eq("id", id).eq("status", "draft").is("deleted_at", null);
      void write({ ...content, edited_by_hand: true })
        .then(({ error }) => (error ? write(content) : undefined))
        .then(() => undefined, () => undefined);
    }, 800),
  );
}
