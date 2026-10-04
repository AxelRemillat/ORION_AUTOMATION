"use server";

import { revalidatePath } from "next/cache";
import { recordProspectEvent } from "@/lib/history/record";
import { createClient } from "@/lib/supabase/server";

/** Note manuelle sur une fiche : un événement « note » horodaté (prospect_events). */
export async function addProspectNote(prospectId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const value = text.trim().slice(0, 2000);
  if (!value) return { ok: false, error: "La note est vide." };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expirée." };
  // La fiche doit être active et à soi (RLS) : pas de note sur une fiche à la corbeille.
  const { data: prospect } = await supabase.from("prospects").select("id").eq("id", prospectId).is("deleted_at", null).maybeSingle();
  if (!prospect) return { ok: false, error: "Fiche introuvable ou à la corbeille." };
  const saved = await recordProspectEvent(supabase, { prospectId, kind: "note", data: { text: value } });
  if (!saved) return { ok: false, error: "Note non enregistrée (historique indisponible)." };
  revalidatePath(`/suivi/${prospectId}`);
  return { ok: true };
}
