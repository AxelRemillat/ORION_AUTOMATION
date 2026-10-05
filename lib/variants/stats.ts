import { autoReplyKind } from "@/lib/inbound/auto-reply";
import { isBounce } from "@/lib/settings/volumes";

/**
 * Ce qui marche — taux de réponse, de rebond et de « stop » par VALEUR de
 * chaque attribut de variante (message_variants), sur les mails ENVOYÉS.
 * Sous 30 envois par valeur : « pas significatif ». Code pur.
 */

export const SIGNIFICANT_SENDS = 30;

export const VARIANT_ATTRIBUTES = [
  { key: "hook_type", label: "Type d'accroche" },
  { key: "pain", label: "Pain" },
  { key: "demo", label: "Démo citée" },
  { key: "cta", label: "Appel à l'action" },
  { key: "subject_style", label: "Style d'objet" },
  { key: "opening_word", label: "Premier mot" },
  { key: "length_band", label: "Longueur" },
] as const;

export type VariantAttribute = (typeof VARIANT_ATTRIBUTES)[number]["key"];

export interface SentVariant {
  prospect_id: string;
  sent_at: string;
  hook_type?: string | null;
  pain?: string | null;
  demo?: string | null;
  cta?: string | null;
  subject_style?: string | null;
  opening_word?: string | null;
  length?: number | null;
}

export interface InboundLite {
  prospect_id: string | null;
  received_at: string;
  from_email: string;
  subject?: string | null;
  body?: string | null;
  category?: string | null;
}

export interface ValueStats {
  value: string;
  sends: number;
  replies: number;
  bounces: number;
  stops: number;
  replyRate: number;
  bounceRate: number;
  stopRate: number;
  significant: boolean;
}

/** Tranches de longueur lisibles (mots du corps). */
export function lengthBand(words: number | null | undefined): string {
  if (!words) return "inconnue";
  if (words < 60) return "< 60 mots";
  if (words <= 90) return "60–90 mots";
  if (words <= 110) return "91–110 mots";
  return "> 110 mots";
}

const isStop = (message: InboundLite) => message.category === "refus" || /^\s*stop\b/i.test(message.body ?? "") || /^\s*stop\b/i.test(message.subject ?? "");

/** Issue d'un envoi : la PREMIÈRE réaction du prospect après l'envoi. */
export function outcomeOf(sent: SentVariant, inbound: readonly InboundLite[]): "reply" | "bounce" | "stop" | null {
  const after = inbound
    // Une réponse automatique (anti-spam, absence) n'est pas une réaction du prospect.
    .filter((message) => message.prospect_id === sent.prospect_id && Date.parse(message.received_at) >= Date.parse(sent.sent_at) && !autoReplyKind(message))
    .sort((a, b) => a.received_at.localeCompare(b.received_at));
  const first = after[0];
  if (!first) return null;
  if (isBounce(first)) return "bounce";
  if (isStop(first)) return "stop";
  return "reply";
}

export function variantStats(sent: readonly SentVariant[], inbound: readonly InboundLite[]): Record<VariantAttribute, ValueStats[]> {
  const outcomes = sent.map((row) => ({ row, outcome: outcomeOf(row, inbound) }));
  const valueOf = (row: SentVariant, key: VariantAttribute) =>
    key === "length_band" ? lengthBand(row.length) : (row[key as keyof SentVariant] as string | null | undefined)?.toString() || "non renseigné";
  const result = {} as Record<VariantAttribute, ValueStats[]>;
  for (const { key } of VARIANT_ATTRIBUTES) {
    const buckets = new Map<string, { sends: number; replies: number; bounces: number; stops: number }>();
    for (const { row, outcome } of outcomes) {
      const value = valueOf(row, key);
      const bucket = buckets.get(value) ?? { sends: 0, replies: 0, bounces: 0, stops: 0 };
      bucket.sends += 1;
      if (outcome === "reply") bucket.replies += 1;
      if (outcome === "bounce") bucket.bounces += 1;
      if (outcome === "stop") bucket.stops += 1;
      buckets.set(value, bucket);
    }
    result[key] = [...buckets]
      .map(([value, b]) => ({
        value,
        ...b,
        replyRate: b.replies / b.sends,
        bounceRate: b.bounces / b.sends,
        stopRate: b.stops / b.sends,
        significant: b.sends >= SIGNIFICANT_SENDS,
      }))
      .sort((a, b) => b.sends - a.sends || b.replyRate - a.replyRate);
  }
  return result;
}
