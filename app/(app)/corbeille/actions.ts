"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  allowAgain,
  deleteForever,
  moveToTrash,
  restoreFromTrash,
  type TrashResult,
} from "@/lib/trash/operations";

/**
 * Actions de corbeille appelées depuis l'UI. Client de session : la RLS
 * limite chaque opération aux lignes de l'utilisateur connecté.
 */

export type TrashActionResult = { ok: true } | { ok: false; error: string };

function done(result: TrashResult): TrashActionResult {
  // Le compteur du menu vit dans le layout : on revalide tout l'arbre.
  if (result.ok) revalidatePath("/", "layout");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function trashProspect(prospectId: string): Promise<TrashActionResult> {
  return done(await moveToTrash(createClient(), prospectId));
}

export async function restoreProspect(prospectId: string): Promise<TrashActionResult> {
  return done(await restoreFromTrash(createClient(), prospectId));
}

export async function deleteProspectForever(prospectId: string): Promise<TrashActionResult> {
  return done(await deleteForever(createClient(), prospectId));
}

export async function allowSirenAgain(siren: string): Promise<TrashActionResult> {
  return done(await allowAgain(createClient(), siren));
}
