"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { liveDigDeps } from "@/lib/funnel/live";
import { isEmail } from "@/lib/mail-preflight/recipient";
import { discard, saveDraft, scheduleBatch, undoDiscard, type CoreResult, type DraftEdit, type ScheduleRequest } from "@/lib/today/actions-core";
import { loadCapacity } from "@/lib/today/capacity";
import { completeOne } from "@/lib/today/complete";
import { DISCARD_REASONS, TODAY_KINDS, type DiscardReason, type SignalCandidateRow, type TodayKind } from "@/types";

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
  const deps = liveDigDeps(ctx.db, ctx.userId, "manuel");
  if (input.candidateId) {
    const { data } = await ctx.db.from("signal_candidates").select("*").eq("id", input.candidateId).maybeSingle();
    if (!data) return { ok: false, error: "Fiche introuvable." };
    const outcome = await completeOne(ctx.db, data as SignalCandidateRow, { deps: { findContact: deps.findContact }, runId: `manuel-${Date.now()}` });
    return done({ ok: true, email: outcome.email });
  }
  const contact = await deps.findContact(input.prospectId).catch(() => null);
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
  const { error } = await ctx.db
    .from("prospects")
    .update({ ...(email ? { email } : {}), ...(website ? { website } : {}) })
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
  return done({ ok: true });
}
