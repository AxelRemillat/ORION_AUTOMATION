import { PLATFORMS, REPLIED_STATUSES, type Opportunity, type Platform } from "./types";

/**
 * Par plateforme : propositions envoyées, taux de réponse, gagnées, CA signé.
 * Code pur (Réglages › Données).
 */

export interface PlatformStats {
  platform: Platform;
  /** Opportunités saisies. */
  total: number;
  /** Propositions envoyées (par la main d'Axel). */
  sent: number;
  replies: number;
  replyRate: number;
  won: number;
  /** Chiffre d'affaires signé (montant saisi à la signature). */
  revenueEur: number;
}

type Row = Pick<Opportunity, "platform" | "status" | "sent_at" | "replied_at" | "amount_eur">;

export function platformStats(rows: readonly Row[]): PlatformStats[] {
  return PLATFORMS.map((platform) => {
    const own = rows.filter((row) => row.platform === platform);
    const sent = own.filter((row) => row.sent_at || (row.status !== "a_repondre" && row.status !== "ignoree"));
    const replies = sent.filter((row) => row.replied_at || REPLIED_STATUSES.includes(row.status));
    const won = own.filter((row) => row.status === "gagnee");
    return {
      platform,
      total: own.length,
      sent: sent.length,
      replies: replies.length,
      replyRate: sent.length ? replies.length / sent.length : 0,
      won: won.length,
      revenueEur: won.reduce((sum, row) => sum + (Number(row.amount_eur) || 0), 0),
    };
  }).filter((row) => row.total > 0);
}
