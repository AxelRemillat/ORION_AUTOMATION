import { notifySendFailed } from "@/lib/notify/events";
import type { NotifyDeps } from "@/lib/notify/ntfy";
import type { Db } from "@/lib/trash/scope";
import { inSendWindow, MIN_GAP_MIN, spacedSlot } from "@/lib/mail-preflight/schedule";
import { scheduleError } from "./paris-time";
import { OPPOSITION_UNVERIFIED_ERROR, oppositionUnverified } from "./opposition-check";
import { checkSendRules, deliver, isEmail, MESSAGE_COLUMNS, type OutboxMessage, type SendDeps } from "./send";

/**
 * Envoi programmé : un brouillon validé reçoit une date (`scheduled_at`) et un
 * destinataire (`scheduled_to`) ; à chaque tick (/api/jobs/tick, pg_cron
 * chaque minute) les mails échus partent par le MÊME chemin que l'envoi
 * manuel (lib/outbox/send.ts).
 *
 * Jamais deux fois : chaque mail passe `scheduled → sending` par une mise à
 * jour conditionnelle. Deux ticks simultanés ciblent la même ligne ; Postgres
 * réévalue le filtre après le verrou de ligne, un seul obtient la ligne.
 * Un `sending` qui dure (fonction coupée après l'appel n8n ?) est déclaré
 * échoué, jamais renvoyé : mieux vaut un doute visible qu'un doublon.
 */

/** Deux reprises espacées après un échec passager, puis `failed`. */
export const RETRY_DELAYS_MIN = [5, 15] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1;
/** Au-delà, un `sending` est considéré comme interrompu. */
export const STUCK_SENDING_MIN = 15;
/** Mails traités par tick : un tick dure quelques secondes, pas plus. */
const BATCH = 10;

export type OutboxResult = { ok: true } | { ok: false; error: string };

/**
 * Programme (ou reprogramme) un brouillon. L'heure RÉELLE peut différer de
 * l'heure demandée : 2 à 7 min après un envoi déjà prévu sur le même créneau,
 * et jamais hors de la fenêtre 8 h – 18 h des jours ouvrés (Paris). Les envois
 * déjà programmés ne bougent pas. `scheduledAt` rend l'heure retenue.
 */
export async function scheduleMessage(
  db: Db,
  input: { userId: string; messageId: string; to: unknown; at: Date | null },
  now = new Date(),
  random: () => number = Math.random,
): Promise<OutboxResult & { scheduledAt?: string }> {
  const invalid = scheduleError(input.at, now);
  if (invalid) return { ok: false, error: invalid };
  if (!isEmail(input.to)) return { ok: false, error: "Destinataire invalide." };

  const { data } = await db
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("id", input.messageId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const message = data as OutboxMessage | null;
  if (!message) return { ok: false, error: "Message introuvable." };

  // Opposition non vérifiée (Pappers épuisé, INPI muet) : rien ne se programme.
  const { data: owner } = await db
    .from("prospects")
    .select("key_figures")
    .eq("id", message.prospect_id)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (oppositionUnverified((owner as { key_figures?: Record<string, unknown> | null } | null)?.key_figures)) {
    return { ok: false, error: OPPOSITION_UNVERIFIED_ERROR };
  }

  // Les règles bloquantes sont vérifiées dès maintenant : inutile de
  // programmer un mail qui échouera au moment de partir. Le plafond, lui,
  // dépend du jour d'envoi : il est jugé à l'envoi.
  const refused = await checkSendRules(db, message, input.to, now);
  if (refused && !refused.ok && refused.status !== 429) return { ok: false, error: refused.error };

  const { data: planned } = await db
    .from("messages")
    .select("id, scheduled_at")
    .eq("user_id", input.userId)
    .in("send_status", ["scheduled", "sending"])
    .is("deleted_at", null);
  const taken = ((planned ?? []) as { id: string; scheduled_at: string | null }[])
    .filter((row) => row.id !== input.messageId && row.scheduled_at)
    .map((row) => new Date(row.scheduled_at as string));
  const at = spacedSlot(input.at as Date, taken, random);

  const { data: updated } = await db
    .from("messages")
    .update({
      send_status: "scheduled",
      scheduled_at: at.toISOString(),
      scheduled_to: input.to as string,
      send_error: null,
      send_attempts: 0,
      send_seen_at: null,
    })
    .eq("id", input.messageId)
    .eq("user_id", input.userId)
    .eq("status", "draft")
    .is("deleted_at", null)
    .in("send_status", ["draft", "scheduled", "failed", "blocked"])
    .select("id");
  return updated?.length
    ? { ok: true, scheduledAt: at.toISOString() }
    : { ok: false, error: "Ce mail ne peut plus être programmé : envoyé, en cours d'envoi ou à la corbeille." };
}

/** Annule une programmation : le mail redevient un brouillon. */
export async function cancelSchedule(db: Db, input: { userId: string; messageId: string }): Promise<OutboxResult> {
  const { data } = await db
    .from("messages")
    .update({ send_status: "draft", scheduled_at: null, send_error: null, send_attempts: 0 })
    .eq("id", input.messageId)
    .eq("user_id", input.userId)
    .in("send_status", ["scheduled", "failed", "blocked"])
    .select("id");
  return data?.length
    ? { ok: true }
    : { ok: false, error: "Trop tard : ce mail est déjà en cours d'envoi ou parti." };
}

export interface TickReport {
  sent: number;
  failed: number;
  retried: number;
  /** Pris par un autre tick entre la lecture et le verrou. */
  skipped: number;
  stuck: number;
  /** Refusés par le contrôle avant envoi : `blocked`, rien n'est parti. */
  blocked: number;
  /** Échus mais retenus au tick suivant : un autre mail est parti il y a moins de 2 min. */
  spaced: number;
  /** Hors fenêtre d'envoi (8 h – 18 h, jours ouvrés, Paris) : rien n'est tenté. */
  outsideWindow: boolean;
}

/** Fait partir les mails programmés échus. Appelé à chaque tick du cron. */
export async function runDueSends(db: Db, deps: SendDeps & { limit?: number; notify?: NotifyDeps } = {}): Promise<TickReport> {
  const now = deps.now ?? new Date();
  const report: TickReport = { sent: 0, failed: 0, retried: 0, skipped: 0, stuck: 0, blocked: 0, spaced: 0, outsideWindow: false };

  // 1. Envois interrompus : déclarés échoués, jamais renvoyés.
  const stuckBefore = new Date(now.getTime() - STUCK_SENDING_MIN * 60_000).toISOString();
  const { data: stuck } = await db
    .from("messages")
    .update({
      send_status: "failed",
      send_started_at: null,
      send_error: "Envoi interrompu : vérifiez dans Gmail s'il est parti avant de le reprogrammer.",
    })
    .eq("send_status", "sending")
    .lt("send_started_at", stuckBefore)
    .select("id, user_id, prospect_id, send_error");
  report.stuck = stuck?.length ?? 0;
  for (const row of (stuck ?? []) as { id: string; user_id: string; prospect_id: string | null; send_error: string | null }[]) {
    await notifySendFailed(db, { userId: row.user_id, messageId: row.id, prospectId: row.prospect_id, error: row.send_error }, deps.notify);
  }

  // 2. Hors fenêtre d'envoi : les mails échus attendent, sans être déplacés.
  if (!inSendWindow(now)) {
    report.outsideWindow = true;
    return report;
  }

  // 3. Mails échus.
  const { data: due } = await db
    .from("messages")
    .select("id, user_id, send_attempts")
    .eq("send_status", "scheduled")
    .is("deleted_at", null)
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(deps.limit ?? BATCH);

  // Filet anti-rafale, SANS déplacer les mails : au plus un départ toutes les
  // 2 min par compte. Des mails programmés avant l'espacement (même heure)
  // partent ainsi à un tick d'écart ou plus, au lieu de la même minute.
  const lastSent = new Map<string, number>();
  for (const candidate of (due ?? []) as { id: string; user_id?: string; send_attempts?: number }[]) {
    const owner = candidate.user_id ?? "";
    if (!lastSent.has(owner)) {
      const { data: recent } = await db
        .from("messages")
        .select("sent_at")
        .eq("user_id", owner)
        .eq("status", "sent")
        .gte("sent_at", new Date(now.getTime() - MIN_GAP_MIN * 60_000).toISOString())
        .limit(1);
      lastSent.set(owner, recent?.length ? now.getTime() : 0);
    }
    if (now.getTime() - (lastSent.get(owner) ?? 0) < MIN_GAP_MIN * 60_000) {
      report.spaced += 1;
      continue;
    }
    const attempt = (candidate.send_attempts ?? 0) + 1;
    // 4. Verrou : seul le tick qui fait passer la ligne à `sending` l'envoie.
    const { data: locked } = await db
      .from("messages")
      .update({ send_status: "sending", send_started_at: now.toISOString(), send_attempts: attempt })
      .eq("id", candidate.id)
      .eq("send_status", "scheduled")
      .is("deleted_at", null)
      .select(MESSAGE_COLUMNS);
    const message = (locked?.[0] ?? null) as (OutboxMessage & { scheduled_to?: string | null }) | null;
    if (!message) {
      report.skipped += 1;
      continue;
    }

    const result = await deliver(db, message, message.scheduled_to ?? "", { ...deps, now });
    if (result.ok) {
      report.sent += 1;
      lastSent.set(owner, now.getTime());
      continue;
    }
    // Refus d'une RÈGLE (409 : ne plus contacter, opposé, perdu, hors cible… — Cowork #48) : comme le contrôle
    // avant envoi, « Bloqué » avec le motif, jamais « Échec » ni nouvel essai. Le plafond du jour (429) n'en est pas.
    if (result.kind === "preflight" || (result.kind === "blocked" && result.status === 409)) {
      // Contrôle avant envoi refusé : rien n'est parti, rien ne sera retenté.
      // Base pas encore migrée (`blocked` refusé par la contrainte) : `failed`, même motif.
      const written = await settle(db, message.id, { send_status: "blocked", send_error: result.error });
      if (!written) await settle(db, message.id, { send_status: "failed", send_error: result.error });
      report.blocked += 1;
      continue;
    }
    if (result.kind === "unrecorded") {
      // Parti mais non enregistré : on le signale, surtout pas de reprise.
      await settle(db, message.id, { send_status: "failed", send_error: result.error });
      report.failed += 1;
      await notifySendFailed(db, { userId: owner, messageId: message.id, prospectId: message.prospect_id, error: result.error }, deps.notify);
      continue;
    }

    const retryable = result.kind === "transient" && attempt < MAX_ATTEMPTS;
    if (retryable) {
      const delay = RETRY_DELAYS_MIN[attempt - 1];
      await settle(db, message.id, {
        send_status: "scheduled",
        scheduled_at: new Date(now.getTime() + delay * 60_000).toISOString(),
        send_error: `Tentative ${attempt}/${MAX_ATTEMPTS} échouée (${result.error}) : nouvel essai dans ${delay} min.`,
      });
      report.retried += 1;
    } else {
      const error =
        result.kind === "transient" ? `Échec après ${MAX_ATTEMPTS} tentatives : ${result.error}` : result.error;
      await settle(db, message.id, { send_status: "failed", send_error: error });
      report.failed += 1;
      // Prévenir sur le téléphone (ntfy) ; jamais bloquant.
      await notifySendFailed(db, { userId: owner, messageId: message.id, prospectId: message.prospect_id, error }, deps.notify);
    }
  }
  return report;
}

/** Rend un message verrouillé, dans l'état décidé par le tick. */
async function settle(db: Db, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await db
    .from("messages")
    .update({ ...patch, send_started_at: null, send_seen_at: null })
    .eq("id", id)
    .eq("send_status", "sending");
  return !error;
}
