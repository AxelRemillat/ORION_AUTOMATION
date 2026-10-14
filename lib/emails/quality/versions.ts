import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";

/**
 * RÉGÉNÉRER SANS PERDRE : l'ancienne version d'un brouillon est rangée dans
 * `message_versions` AVANT d'être remplacée. Si l'historique ne peut pas être
 * écrit, le brouillon n'est PAS remplacé.
 *
 * Un brouillon retouché par Axel (`edited_by_hand`) n'est jamais réécrit par un
 * job automatique (préparation, fiche complétée, régénération groupée) ; seule
 * une demande explicite le régénère — avec, là aussi, l'ancienne version gardée.
 */

type Db = SupabaseClient<Database>;

export interface DraftPatch {
  subject: string | null;
  body: string;
  quality_score?: number | null;
  quality_reason?: string | null;
  /** Brouillon d'un script repris par l'application (Cowork #58) : il devient un brouillon de l'application. */
  origin?: null;
}

/**
 * `locked` : brouillon VALIDÉ ou PROGRAMMÉ par Axel — un job automatique ne le
 * réécrit jamais, même s'il l'a été entre la lecture et l'écriture (le texte
 * envoyé doit être celui qu'Axel a vu). Vérifié deux fois : à la lecture, puis
 * dans la condition de l'écriture.
 */
export type ReplaceOutcome = "saved" | "edited" | "unchanged" | "locked";

export async function replaceDraft(
  ctx: { db: Db; userId: string },
  messageId: string,
  patch: DraftPatch,
  options: { auto: boolean; reason: string },
): Promise<ReplaceOutcome> {
  const { data, error } = await ctx.db.from("messages").select("*").eq("id", messageId).maybeSingle();
  if (error) throw new Error(`brouillon illisible : ${error.message}`);
  const current = data as {
    subject: string | null;
    body: string;
    quality_score?: number | null;
    edited_by_hand?: boolean;
    status: string;
    validated_at?: string | null;
    scheduled_at?: string | null;
  } | null;
  if (!current || current.status !== "draft") throw new Error("brouillon introuvable ou déjà parti");
  if (options.auto && current.edited_by_hand) return "edited";
  if (options.auto && (current.validated_at || current.scheduled_at)) return "locked";
  if (current.body.trim() === patch.body.trim() && (current.subject ?? "") === (patch.subject ?? "")) return "unchanged";

  const archived = await ctx.db.from("message_versions").insert({
    user_id: ctx.userId,
    message_id: messageId,
    subject: current.subject,
    body: current.body,
    quality_score: current.quality_score ?? null,
    reason: options.reason,
  });
  if (archived.error) throw new Error(`historique non écrit, brouillon conservé tel quel : ${archived.error.message}`);

  let update = ctx.db
    .from("messages")
    .update({ ...patch, edited_by_hand: false })
    .eq("id", messageId)
    .eq("status", "draft")
    .not("send_status", "in", "(scheduled,sending)");
  // Validé, programmé ou retouché ENTRE la lecture et l'écriture : on n'écrit pas.
  if (options.auto) update = update.is("validated_at", null).is("scheduled_at", null).eq("edited_by_hand", false);
  const { data: written, error: updateError } = await update.select("id");
  if (updateError) throw new Error(`brouillon non enregistré : ${updateError.message}`);
  return (written ?? []).length ? "saved" : "locked";
}
