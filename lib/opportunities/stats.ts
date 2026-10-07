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

/**
 * COCKPIT (plateformes #1) — par plateforme, sur une fenêtre glissante :
 * propositions envoyées, réponses, conversations, missions gagnées. Chaque
 * jalon est compté à SA date (sent_at, replied_at, conversation_at, won_at) ;
 * une fiche antérieure à ces colonnes retombe sur sa dernière mise à jour.
 */
export interface PlatformActivity {
  platform: Platform;
  sent: number;
  replies: number;
  conversations: number;
  won: number;
}

export const ACTIVITY_WINDOWS = [7, 30] as const;
export type ActivityWindow = (typeof ACTIVITY_WINDOWS)[number];

type ActivityRow = Pick<Opportunity, "platform" | "status" | "sent_at" | "replied_at" | "updated_at"> &
  Partial<Pick<Opportunity, "conversation_at" | "won_at">>;

const CONVERSATION_STATUSES: readonly string[] = ["entretien", "gagnee"];

export function platformActivity(rows: readonly ActivityRow[], days: number, now = new Date()): PlatformActivity[] {
  const since = now.getTime() - days * 86_400_000;
  const within = (iso: string | null | undefined) => Boolean(iso) && Date.parse(iso as string) >= since && Date.parse(iso as string) <= now.getTime();
  return PLATFORMS.map((platform) => {
    const own = rows.filter((row) => row.platform === platform);
    return {
      platform,
      sent: own.filter((row) => within(row.sent_at)).length,
      replies: own.filter((row) => within(row.replied_at)).length,
      conversations: own.filter((row) => within(row.conversation_at ?? (CONVERSATION_STATUSES.includes(row.status) ? row.updated_at : null))).length,
      won: own.filter((row) => within(row.won_at ?? (row.status === "gagnee" ? row.updated_at : null))).length,
    };
  }).filter((row) => row.sent + row.replies + row.conversations + row.won > 0);
}

/**
 * RÉSUMÉ DU COCKPIT (plateformes #3) — les 3 sources de prospection freelance :
 * Codeur, Upwork, Malt/ComeUp. Taux de réponse sur 30 jours = part des
 * propositions ENVOYÉES dans la fenêtre qui ont reçu une réponse.
 */
export const FREELANCE_SOURCES = [
  { key: "codeur", label: "Codeur", platforms: ["codeur"] },
  { key: "upwork", label: "Upwork", platforms: ["upwork"] },
  { key: "malt_comeup", label: "Malt/ComeUp", platforms: ["malt", "comeup"] },
] as const satisfies readonly { key: string; label: string; platforms: readonly Platform[] }[];

export interface FreelanceSource {
  key: (typeof FREELANCE_SOURCES)[number]["key"];
  label: string;
  sent: number;
  replies: number;
  /** `null` : rien d'envoyé sur 30 jours. */
  replyRate: number | null;
}

export function freelanceSources(rows: readonly Pick<Opportunity, "platform" | "sent_at" | "replied_at">[], now = new Date(), days = 30): FreelanceSource[] {
  const since = now.getTime() - days * 86_400_000;
  return FREELANCE_SOURCES.map((source) => {
    const sent = rows.filter((row) => (source.platforms as readonly Platform[]).includes(row.platform) && row.sent_at && Date.parse(row.sent_at) >= since && Date.parse(row.sent_at) <= now.getTime());
    const replies = sent.filter((row) => row.replied_at).length;
    return { key: source.key, label: source.label, sent: sent.length, replies, replyRate: sent.length ? replies / sent.length : null };
  });
}
