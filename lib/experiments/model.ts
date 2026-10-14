/**
 * EXPÉRIENCES SUR LES MAILS (Cowork #30) — règles pures.
 *
 * Une expérience compare des PHRASES D'APPEL À L'ACTION (« 15 min la semaine
 * prochaine ? » contre « je vous envoie une vidéo de 2 min ? »). Tout le reste
 * du mail — prompts, règles, juge — est identique d'une variante à l'autre :
 * seule la dernière phrase change (lib/emails/quality/generate.ts, `cta`).
 *
 * Sans expérience active, rien ne change : aucune variante n'est tirée et le
 * mail garde sa demande habituelle (`ctaFor`, F3_CTA).
 */
export interface ExperimentVariant {
  /** Clé courte et stable : « A », « B », « video »… */
  key: string;
  /** La phrase d'appel à l'action, telle qu'elle finira le mail. */
  cta: string;
}

export interface MailExperiment {
  id: string;
  name: string;
  variants: ExperimentVariant[];
  active: boolean;
  started_at: string | null;
}

/** Variantes valides : au moins deux, clés distinctes, phrases non vides finissant par « ? ». */
export function parseVariants(raw: unknown): ExperimentVariant[] | null {
  if (!Array.isArray(raw)) return null;
  const variants = raw
    .map((item) => ({ key: String((item as ExperimentVariant)?.key ?? "").trim(), cta: String((item as ExperimentVariant)?.cta ?? "").replace(/\s+/g, " ").trim() }))
    .filter((item) => item.key && item.cta);
  if (variants.length < 2 || variants.length !== raw.length) return null;
  if (new Set(variants.map((item) => item.key)).size !== variants.length) return null;
  // Une seule question par mail, et c'est la demande (lib/emails/validate.ts).
  if (variants.some((item) => !item.cta.endsWith("?") || item.cta.length > 200)) return null;
  return variants;
}

/**
 * Tirage ÉQUILIBRÉ : parmi les variantes les moins servies jusqu'ici, une au
 * hasard. Les effectifs ne s'écartent donc jamais de plus d'une unité.
 */
export function pickVariant(variants: readonly ExperimentVariant[], counts: Readonly<Record<string, number>>, random: () => number = Math.random): ExperimentVariant {
  const least = Math.min(...variants.map((variant) => counts[variant.key] ?? 0));
  const candidates = variants.filter((variant) => (counts[variant.key] ?? 0) === least);
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
}

/** Seuil sous lequel l'encart du Cockpit prévient : trop peu d'envois pour conclure. */
export const MIN_SENT_PER_VARIANT = 50;
