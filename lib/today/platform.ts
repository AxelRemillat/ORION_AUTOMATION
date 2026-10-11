import { fallbackFollowUp } from "@/lib/opportunities/follow-up";
import { daysSinceSent, followUpDue } from "@/lib/opportunities/follow-up-due";
import { PLATFORM_LABELS, proposalLanguage, type Opportunity, type Platform } from "@/lib/opportunities/types";

/**
 * CONVERSATIONS DE PLATEFORME DANS « AUJOURD'HUI » (Cowork #17).
 *
 * Codeur, Malt, ComeUp et Upwork n'ont pas d'API de messagerie, et on ne
 * scrape pas. Ce qu'ORION sait d'une conversation vient donc de deux sources :
 * la proposition qu'Axel a enregistrée ici, et les e-mails de notification
 * ingérés par n8n. Ce module en tire les deux tâches du jour :
 *
 *   - un message reçu, à traiter (statut « Réponse ») ;
 *   - une relance due (3 jours Codeur/Malt/ComeUp, 5 jours Upwork).
 *
 * Code PUR, sans accès base : il se teste sur des fixtures, et il ne compte
 * JAMAIS dans le plafond d'envoi — rien ne part d'ORION, Axel copie le texte
 * et répond sur la plateforme.
 */

export type PlatformTaskKind = "message" | "relance";

export interface PlatformTask {
  kind: PlatformTaskKind;
  opportunityId: string;
  platform: Platform;
  /** « Codeur », « Malt »… pour le badge. */
  platformLabel: string;
  title: string;
  /** Lien de l'annonce ou de la conversation, repris de l'e-mail ou du flux. */
  url: string | null;
  /** Proposition déjà envoyée, avec sa date : le début de la conversation. */
  sent: { at: string; text: string | null } | null;
  /** Date du message reçu, si on la connaît. */
  receivedAt: string | null;
  /**
   * Extrait du message reçu quand l'e-mail de notification le porte. Codeur
   * n'en met pas : on le dit au lieu d'inventer un contenu.
   */
  excerpt: string | null;
  /** Texte à copier : la relance suggérée. `null` pour un message reçu. */
  text: string | null;
  /** Jours écoulés depuis l'envoi de la proposition. */
  days: number | null;
}

type Row = Pick<Opportunity, "id" | "platform" | "status" | "title" | "url" | "sent_at" | "replied_at" | "proposal" | "language"> &
  Partial<Pick<Opportunity, "followed_up_at" | "conversation_at" | "follow_up_text">>;

/** Extrait du dernier e-mail reçu pour cette fiche, quand il en porte un. */
export interface InboundExcerpt {
  opportunityId: string;
  receivedAt: string;
  excerpt: string | null;
}

const label = (platform: Platform) => PLATFORM_LABELS[platform] ?? platform;

/**
 * Un message reçu attend une réponse : statut « Réponse », pas encore traité.
 *
 * On ne se fie pas à la seule présence d'un e-mail : c'est le statut de la
 * fiche qui dit si la balle est dans notre camp, et il est posé par l'ingest
 * quand un e-mail « message » arrive.
 */
export function messagesToAnswer(rows: readonly Row[], inbound: readonly InboundExcerpt[] = []): PlatformTask[] {
  const lastByOpportunity = new Map<string, InboundExcerpt>();
  for (const item of inbound) {
    const current = lastByOpportunity.get(item.opportunityId);
    if (!current || item.receivedAt > current.receivedAt) lastByOpportunity.set(item.opportunityId, item);
  }

  return rows
    .filter((row) => row.status === "reponse")
    .map((row) => {
      const mail = lastByOpportunity.get(row.id) ?? null;
      return {
        kind: "message" as const,
        opportunityId: row.id,
        platform: row.platform,
        platformLabel: label(row.platform),
        title: row.title,
        url: row.url ?? null,
        sent: row.sent_at ? { at: row.sent_at, text: row.proposal ?? null } : null,
        receivedAt: mail?.receivedAt ?? row.replied_at ?? row.conversation_at ?? null,
        excerpt: mail?.excerpt?.trim() || null,
        text: null,
        days: daysSinceSent(row),
      };
    })
    .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
}

/** Relances dues, la plus ancienne d'abord : celle qui attend depuis le plus longtemps. */
export function followUpsToSend(rows: readonly Row[], now = new Date()): PlatformTask[] {
  return rows
    .filter((row) => followUpDue(row, now))
    .map((row) => ({
      kind: "relance" as const,
      opportunityId: row.id,
      platform: row.platform,
      platformLabel: label(row.platform),
      title: row.title,
      url: row.url ?? null,
      sent: row.sent_at ? { at: row.sent_at, text: row.proposal ?? null } : null,
      receivedAt: null,
      excerpt: null,
      // Le texte déjà rédigé s'il existe, sinon le modèle sûr : Axel a toujours
      // quelque chose à copier, même si le rédacteur n'a jamais tourné.
      text: row.follow_up_text?.trim() || fallbackFollowUp(row, proposalLanguage(row.platform, row.language ?? null)),
      days: daysSinceSent(row, now),
    }))
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
}

/** Ce que l'en-tête compte en plus : ces tâches sont du travail du jour. */
export const platformCounts = (tasks: readonly PlatformTask[]) => ({
  messages: tasks.filter((task) => task.kind === "message").length,
  relances: tasks.filter((task) => task.kind === "relance").length,
});
