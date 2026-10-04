"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { liveDigDeps } from "@/lib/funnel/live";
import { isEmail } from "@/lib/mail-preflight/recipient";
import { discard, saveDraft, scheduleBatch, undoDiscard, type CoreResult, type DraftEdit, type ScheduleRequest } from "@/lib/today/actions-core";
import { loadCapacity } from "@/lib/today/capacity";
import { completeOne } from "@/lib/today/complete";
import { exclusionOf } from "@/lib/today/items";
import { draftIfReady } from "@/lib/today/auto-draft";
import { draftReply } from "@/lib/outbox/reply-generate";
import { DISCARD_REASONS, TODAY_KINDS, type DiscardReason, type InboundMessage, type Prospect, type SignalCandidateRow, type TodayKind } from "@/types";

/**
 * Actions de l'écran « Aujourd'hui ». Client de session : la RLS limite tout
 * aux lignes de l'utilisateur connecté. La logique vit dans lib/today.
 */

const SESSION: { ok: false; error: string } = { ok: false, error: "Session expirée. Reconnectez-vous." };

async function session() {
  const db = createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return user ? { db, userId: user.id } : null;
}

function done<T extends CoreResult<object>>(result: T): T {
  if (result.ok) revalidatePath("/aujourdhui");
  return result;
}

export async function saveTodayDraft(edit: DraftEdit) {
  const ctx = await session();
  return ctx ? done(await saveDraft(ctx.db, ctx.userId, edit)) : SESSION;
}

export async function validateToday(edit: DraftEdit, validate: boolean) {
  const ctx = await session();
  return ctx ? done(await saveDraft(ctx.db, ctx.userId, edit, validate)) : SESSION;
}

export async function discardToday(input: {
  kind: TodayKind;
  reason: DiscardReason;
  prospectId: string | null;
  messageId: string | null;
  inboundId: string | null;
  candidateId: string | null;
}) {
  if (!TODAY_KINDS.includes(input.kind) || !DISCARD_REASONS.includes(input.reason)) return { ok: false as const, error: "Motif inconnu." };
  const ctx = await session();
  return ctx ? done(await discard(ctx.db, ctx.userId, input)) : SESSION;
}

export async function undoDiscardToday(discardId: string) {
  const ctx = await session();
  return ctx ? done(await undoDiscard(ctx.db, ctx.userId, discardId)) : SESSION;
}

export async function scheduleToday(requests: ScheduleRequest[]) {
  const ctx = await session();
  if (!ctx) return SESSION;
  const capacity = await loadCapacity(ctx.db, ctx.userId);
  return done(await scheduleBatch(ctx.db, ctx.userId, requests, capacity.remaining));
}

/** « Compléter avec ORION » : la chaîne contact (site → Linkup → Hunter dans le budget). */
export async function completeToday(input: { prospectId: string; candidateId: string | null }): Promise<CoreResult<{ email: string | null }>> {
  const ctx = await session();
  if (!ctx) return SESSION;
  // Fiche opposée, « ne plus contacter » ou hors cible : aucune complétion.
  const { data: owner } = await ctx.db.from("prospects").select("*").eq("id", input.prospectId).eq("user_id", ctx.userId).maybeSingle();
  const why = owner ? exclusionOf(owner as Prospect) : "fiche introuvable";
  if (why) return { ok: false, error: `Complétion refusée : ${why}.` };
  const deps = liveDigDeps(ctx.db, ctx.userId, "manuel");
  if (input.candidateId) {
    const { data } = await ctx.db.from("signal_candidates").select("*").eq("id", input.candidateId).maybeSingle();
    if (!data) return { ok: false, error: "Fiche introuvable." };
    const outcome = await completeOne(ctx.db, data as SignalCandidateRow, { deps: { findContact: deps.findContact }, runId: `manuel-${Date.now()}` });
    if (outcome.email) await draftIfReady(ctx.db, ctx.userId, input.prospectId).catch(() => null);
    return done({ ok: true, email: outcome.email });
  }
  const contact = await deps.findContact(input.prospectId).catch(() => null);
  if (contact?.email) await draftIfReady(ctx.db, ctx.userId, input.prospectId).catch(() => null);
  return done({ ok: true, email: contact?.email ?? null });
}

/** Saisie manuelle de l'email ou du site. L'ancienne valeur reste dans l'historique du contact. */
export async function setTodayContact(input: { prospectId: string; candidateId: string | null; email?: string; website?: string }): Promise<CoreResult> {
  const ctx = await session();
  if (!ctx) return SESSION;
  const email = input.email?.trim().toLowerCase();
  if (email !== undefined && !isEmail(email)) return { ok: false, error: "Adresse email invalide." };
  const site = input.website?.trim();
  const website = site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : undefined;
  // Nouveau site : l'échec de lecture du précédent ne compte plus.
  let figuresPatch: Record<string, unknown> = {};
  if (website) {
    const { data: current } = await ctx.db.from("prospects").select("key_figures").eq("id", input.prospectId).maybeSingle();
    const figures = ((current as { key_figures?: Record<string, unknown> | null } | null)?.key_figures ?? {}) as Record<string, unknown>;
    // Nouveau site : l'échec de lecture et le « À revoir » faute de profil
    // ne comptent plus — la rédaction sera retentée.
    if (typeof figures.profile_failed_at === "string" || figures.mail_review) {
      const { profile_failed_at: _cleared, mail_review: _review, ...rest } = figures;
      figuresPatch = { key_figures: rest };
    }
  }
  const { error } = await ctx.db
    .from("prospects")
    .update({ ...(email ? { email } : {}), ...(website ? { website } : {}), ...figuresPatch })
    .eq("id", input.prospectId);
  if (error) return { ok: false, error: error.message };
  if (email && input.candidateId) {
    const { data } = await ctx.db.from("signal_candidates").select("contact").eq("id", input.candidateId).maybeSingle();
    const previous = ((data as { contact?: Record<string, unknown> } | null)?.contact ?? {}) as Record<string, unknown>;
    await ctx.db
      .from("signal_candidates")
      .update({
        publication: "pret",
        contact: { ...previous, previous_email: previous.email ?? null, email, doubtful: false, found_by: "saisie manuelle" },
      })
      .eq("id", input.candidateId);
  }
  // Fiche complétée : le brouillon part tout seul (relit le site, puis rédige).
  await draftIfReady(ctx.db, ctx.userId, input.prospectId).catch(() => null);
  return done({ ok: true });
}

/** Brouillon de réponse manquant : même générateur que la préparation du matin. */
export async function draftReplyToday(inboundId: string): Promise<CoreResult> {
  const ctx = await session();
  if (!ctx) return SESSION;
  const { data } = await ctx.db.from("inbound_messages").select("*").eq("id", inboundId).is("deleted_at", null).maybeSingle();
  if (!data) return { ok: false, error: "Mail reçu introuvable." };
  const result = await draftReply(ctx.db, { userId: ctx.userId, inbound: data as InboundMessage });
  return result.ok ? done({ ok: true }) : result;
}
