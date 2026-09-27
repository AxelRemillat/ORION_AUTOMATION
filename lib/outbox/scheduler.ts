import type { Db } from "@/lib/trash/scope";
import { scheduleError } from "./paris-time";
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

/** Programme (ou reprogramme) un brouillon. */
export async function scheduleMessage(
  db: Db,
  input: { userId: string; messageId: string; to: unknown; at: Date | null },
  now = new Date(),
): Promise<OutboxResult> {
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

  // Les règles bloquantes sont vérifiées dès maintenant : inutile de
  // programmer un mail qui échouera au moment de partir. Le plafond, lui,
  // dépend du jour d'envoi : il est jugé à l'envoi.
  const refused = await checkSendRules(db, message, input.to, now);
  if (refused && !refused.ok && refused.status !== 429) return { ok: false, error: refused.error };

  const { data: updated } = await db
    .from("messages")
    .update({
      send_status: "scheduled",
      scheduled_at: (input.at as Date).toISOString(),
      scheduled_to: input.to as string,
      send_error: null,
      send_attempts: 0,
      send_seen_at: null,
    })
    .eq("id", input.messageId)
    .eq("user_id", input.userId)
    .eq("status", "draft")
    .is("deleted_at", null)
    .in("send_status", ["draft", "scheduled", "failed"])
    .select("id");
  return updated?.length
    ? { ok: true }
    : { ok: false, error: "Ce mail ne peut plus être programmé : envoyé, en cours d'envoi ou à la corbeille." };
}

/** Annule une programmation : le mail redevient un brouillon. */
export async function cancelSchedule(db: Db, input: { userId: string; messageId: string }): Promise<OutboxResult> {
  const { data } = await db
    .from("messages")
    .update({ send_status: "draft", scheduled_at: null, send_error: null, send_attempts: 0 })
    .eq("id", input.messageId)
    .eq("user_id", input.userId)
    .in("send_status", ["scheduled", "failed"])
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
}

/** Fait partir les mails programmés échus. Appelé à chaque tick du cron. */
export async function runDueSends(db: Db, deps: SendDeps & { limit?: number } = {}): Promise<TickReport> {
  const now = deps.now ?? new Date();
  const report: TickReport = { sent: 0, failed: 0, retried: 0, skipped: 0, stuck: 0 };

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
    .select("id");
  report.stuck = stuck?.length ?? 0;

  // 2. Mails échus.
  const { data: due } = await db
    .from("messages")
    .select("id, send_attempts")
    .eq("send_status", "scheduled")
    .is("deleted_at", null)
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(deps.limit ?? BATCH);

  for (const candidate of (due ?? []) as { id: string; send_attempts?: number }[]) {
    const attempt = (candidate.send_attempts ?? 0) + 1;
    // 3. Verrou : seul le tick qui fait passer la ligne à `sending` l'envoie.
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
      continue;
    }
    if (result.kind === "unrecorded") {
      // Parti mais non enregistré : on le signale, surtout pas de reprise.
      await settle(db, message.id, { send_status: "failed", send_error: result.error });
      report.failed += 1;
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
    }
  }
  return report;
}

/** Rend un message verrouillé, dans l'état décidé par le tick. */
async function settle(db: Db, id: string, patch: Record<string, unknown>): Promise<void> {
  await db
    .from("messages")
    .update({ ...patch, send_started_at: null, send_seen_at: null })
    .eq("id", id)
    .eq("send_status", "sending");
}
