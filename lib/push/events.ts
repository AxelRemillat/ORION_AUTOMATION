import { isProspectReply } from "@/lib/inbound/auto-reply";
import { laneOf } from "@/lib/opportunities/lane";
import type { Db } from "@/lib/trash/scope";
import { alertPayload, replyPayload } from "./payload";
import { pushToDevices, type PushDeps, type PushOutcome } from "./send";

/** Tables hors du schéma typé (push_subscriptions est neuve) : accès non typé, comme lib/badges/counts.ts. */
const from = (db: Db, table: string) => (db as unknown as { from: (name: string) => any }).from(table);

/**
 * Les DEUX notifications PC d'ORION (Cowork #28), déclenchées là où ORION
 * enregistre l'événement — au même endroit que le ntfy du téléphone :
 *   - /api/inbound, mail reçu enregistré → vraie réponse d'un prospect
 *     (ni absence, ni anti-spam, ni rebond ; un refus en est une) ;
 *   - `markAlerted` (lib/opportunities/ingest.ts), offre passée en Alerte.
 * Rien d'autre : ni envoi, ni relance, ni coût.
 */
export async function pushInboundReply(
  db: Db,
  input: {
    userId: string;
    inboundId: string;
    prospectId: string | null;
    companyName: string | null;
    message: { from_email: string; subject?: string | null; body?: string | null; auto_submitted?: string | null };
  },
  deps: PushDeps = {},
): Promise<PushOutcome | null> {
  if (!isProspectReply(input.message)) return null;
  const payload = replyPayload({ inboundId: input.inboundId, prospectId: input.prospectId, companyName: input.companyName, fromEmail: input.message.from_email, body: input.message.body });
  return pushToDevices(db, input.userId, `reply:${input.inboundId}`, payload, deps);
}

type Row = { id: string; platform: string; title: string | null; body: string | null; budget: string | null; categories: string[] | null; published_at: string | null; created_at: string | null; fit_score: number | null };

/** Offre passée en Alerte : relue en base (titre, plateforme, voie, score). */
export async function pushOpportunityAlert(db: Db, userId: string, id: string, deps: PushDeps = {}): Promise<PushOutcome | null> {
  const { data } = await from(db, "opportunities").select("id, platform, title, body, budget, categories, published_at, created_at, fit_score").eq("id", id).maybeSingle();
  const row = data as Row | null;
  if (!row) return null;
  const now = (deps.now ?? (() => new Date()))();
  const payload = alertPayload({ id, platform: row.platform, title: row.title ?? "Nouvelle offre", lane: laneOf(row as never, now), score: row.fit_score });
  return pushToDevices(db, userId, `opportunite:${id}`, payload, deps);
}
