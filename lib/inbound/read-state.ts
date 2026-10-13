import type { InboundMessage, Prospect } from "@/types";
import { autoReplyKind } from "./auto-reply";
import { isBounce } from "./bounce";

/**
 * « Lu / non lu » des mails reçus — règles PURES, partagées par la boîte mail,
 * ses compteurs et le badge de navigation.
 *
 * Deux notions qu'on confond vite, et qu'il faut garder séparées :
 *   - `handled` = SOLDÉ. Une réponse est partie, ou un anti-spam a été validé.
 *     C'est ce drapeau qui sort le mail de la file d'« Aujourd'hui ».
 *   - `read_at` = LU. Axel l'a ouvert. N'enlève rien de la file du jour : un
 *     mail lu mais sans réponse reste à traiter.
 *
 * Le POINT « non lu » de la liste dit la vérité brute (`read_at` vide). Le
 * BADGE, lui, ne compte que ce qui demande une action : une absence n'en
 * demande aucune, un anti-spam déjà validé non plus (Cowork #21 : Axel voyait
 * des compteurs qui ne correspondaient plus à rien).
 */

type ReadableMessage = Pick<InboundMessage, "id" | "from_email" | "subject" | "body" | "prospect_id"> & {
  read_at?: string | null;
  deleted_at?: string | null;
};

/** `true` si le mail n'a pas encore été ouvert. */
export const isUnread = (message: { read_at?: string | null }): boolean => !message.read_at;

/**
 * Identifiants des challenges anti-spam marqués « Validé ».
 *
 * La validation est notée sur la FICHE (`key_figures.antispam_validated_at` +
 * l'identifiant du mail concerné), pas sur le mail : c'est la fiche qui porte
 * l'état de la relation. Le compteur a donc besoin des prospects.
 */
export function validatedAntispamIds(prospects: Pick<Prospect, "id" | "key_figures">[]): Set<string> {
  const ids = new Set<string>();
  for (const prospect of prospects) {
    const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
    const inboundId = figures.antispam_inbound_id;
    if (typeof inboundId === "string" && figures.antispam_validated_at) ids.add(inboundId);
  }
  return ids;
}

/**
 * `true` si ce mail doit peser dans le badge « boîte mail » : vivant, non lu,
 * et porteur d'une action — ni absence, ni anti-spam déjà validé, ni rebond
 * (Cowork #28 : le compteur de l'onglet ne compte que les vraies réponses ; un
 * refus en est une, il compte tant qu'il n'est pas lu).
 */
export function countsAsUnread(message: ReadableMessage, validatedIds: ReadonlySet<string> = new Set()): boolean {
  if (message.deleted_at || !isUnread(message)) return false;
  if (isBounce({ from_email: message.from_email, subject: message.subject })) return false;
  const kind = autoReplyKind({ from_email: message.from_email, subject: message.subject, body: message.body });
  if (kind === "absence") return false;
  if (kind === "antispam" && validatedIds.has(message.id)) return false;
  return true;
}

/** Nombre de mails reçus qui demandent encore d'être lus. */
export function unreadBadgeCount(
  inbound: ReadableMessage[],
  prospects: Pick<Prospect, "id" | "key_figures">[] = [],
): number {
  const validated = validatedAntispamIds(prospects);
  return inbound.filter((message) => countsAsUnread(message, validated)).length;
}
