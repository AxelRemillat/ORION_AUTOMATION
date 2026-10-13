import { utcToParis } from "@/lib/outbox/paris-time";

/**
 * ENTONNOIR DE PRODUCTION (Cowork #27) — code pur, lecture seule.
 *
 * Du signal collecté au mail prêt (≥ 9/10), par jour ouvré et au total, avec le coût de
 * chaque étape. Les étapes suivent les traces que le pipeline laisse en base (cartographie
 * du 13/10/2026) : `signal_candidates` (statut, motif_rejet, identity, contact, publication),
 * `prospects` (business_profile, key_figures.mail_review), `messages` (intro, quality_score)
 * et `api_usage` (operation).
 */

export interface FunnelSignal {
  created_at: string;
  source: string;
  statut: string;
  motif_rejet: string | null;
  identity: unknown;
  publication: string | null;
  contact: { badge?: string | null } | null;
  prospect_id: string | null;
}
export interface FunnelProspect { id: string; created_at: string; business_profile: unknown; key_figures: Record<string, unknown> | null; website: string | null; email: string | null }
export interface FunnelDraft { prospect_id: string | null; created_at: string; quality_score: number | null; quality_reason: string | null; origin?: string | null }
export interface FunnelUsage { created_at: string; service: string; operation: string; units: number | null; cost: number | null }

export const STAGES = [
  "collectés",
  "examinés",
  "trouvés au registre",
  "non opposés",
  "hors cible écartés",
  "retenus (tri)",
  "site trouvé",
  "e-mail trouvé",
  "profil métier lu",
  "faits suffisants",
  "brouillon rédigé",
  "prêt (≥ 9/10)",
] as const;
export type Stage = (typeof STAGES)[number];

const OFF_TARGET = /(agence d'emploi|signal pour un client|trop grande structure|grand groupe|filiale d'un groupe|capitaux propres|aucun salarié déclaré)/i;
const OPPOSED = /opposition à la prospection/i;
const NOT_EXAMINED = /^non examiné/i;

export interface FunnelReport {
  days: string[];
  /** Volume par étape et par jour (jour Paris de création de la ligne mesurée). */
  byDay: Record<string, Record<Stage, number>>;
  totals: Record<Stage, number>;
  extra: { offTarget: number; opposed: number; nominative: number; generic: number; factsBlocked: number; aRevoir: number; brut: number; notExamined: number };
  /** Coût par famille d'opérations (€) et unités (crédits) sur la fenêtre. */
  cost: { family: string; eur: number; units: number }[];
}

const day = (iso: string) => utcToParis(new Date(iso)).date;

export function costFamily(service: string, operation: string): string {
  if (service === "hunter") return "Hunter (contacts, vérifications)";
  if (service === "pappers") return "Pappers (registre)";
  if (service === "linkup") return "Linkup (sites, enrichissement)";
  if (/^entonnoir:tri/.test(operation)) return "OpenAI · tri des signaux";
  if (/^(profil-metier|facts|extract-signals|contact:)/.test(operation)) return "OpenAI · profil, faits, contact";
  if (/^(strategie|qualite:redaction|qualite:raccourci)/.test(operation)) return "OpenAI · rédaction";
  if (/^qualite:(checklist|juge)/.test(operation)) return "OpenAI · juge";
  if (/^relance/.test(operation)) return "OpenAI · relances";
  return "OpenAI · autres";
}

export function buildProductionFunnel(input: { signals: readonly FunnelSignal[]; prospects: readonly FunnelProspect[]; drafts: readonly FunnelDraft[]; usage: readonly FunnelUsage[]; since: string; until: string }): FunnelReport {
  const days: string[] = [];
  for (let cursor = new Date(`${input.since}T12:00:00Z`); cursor.toISOString().slice(0, 10) <= input.until; cursor = new Date(cursor.getTime() + 86_400_000)) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) days.push(cursor.toISOString().slice(0, 10));
  }
  const empty = () => Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<Stage, number>;
  const byDay: Record<string, Record<Stage, number>> = Object.fromEntries(days.map((value) => [value, empty()]));
  const totals = empty();
  const add = (iso: string, stage: Stage) => {
    totals[stage] += 1;
    const key = day(iso);
    if (byDay[key]) byDay[key][stage] += 1;
  };
  const extra = { offTarget: 0, opposed: 0, nominative: 0, generic: 0, factsBlocked: 0, aRevoir: 0, brut: 0, notExamined: 0 };
  for (const signal of input.signals) {
    add(signal.created_at, "collectés");
    const motif = signal.motif_rejet ?? "";
    if (signal.statut === "brut") extra.brut += 1;
    if (NOT_EXAMINED.test(motif)) extra.notExamined += 1;
    if (signal.statut === "brut" || NOT_EXAMINED.test(motif)) continue;
    add(signal.created_at, "examinés");
    if (!signal.identity) continue;
    add(signal.created_at, "trouvés au registre");
    if (OPPOSED.test(motif)) {
      extra.opposed += 1;
      continue;
    }
    add(signal.created_at, "non opposés");
    if (OFF_TARGET.test(motif)) {
      extra.offTarget += 1;
      add(signal.created_at, "hors cible écartés");
      continue;
    }
    if (signal.statut === "retenu" || signal.statut === "creusé") add(signal.created_at, "retenus (tri)");
    if (signal.statut === "creusé") {
      add(signal.created_at, "site trouvé");
      if (signal.publication === "pret") {
        add(signal.created_at, "e-mail trouvé");
        if (signal.contact?.badge === "nominatif") extra.nominative += 1;
        else extra.generic += 1;
      }
    }
  }
  const drafts = new Map<string, FunnelDraft>();
  for (const draft of input.drafts) if (draft.prospect_id && !draft.origin) drafts.set(draft.prospect_id, draft);
  for (const prospect of input.prospects) {
    if (prospect.business_profile && Object.keys(prospect.business_profile as object).length) add(prospect.created_at, "profil métier lu");
    else continue;
    const review = (prospect.key_figures?.mail_review as { reason?: string } | undefined)?.reason ?? "";
    if (/^Faits insuffisants/.test(review)) {
      extra.factsBlocked += 1;
      continue;
    }
    add(prospect.created_at, "faits suffisants");
    const draft = drafts.get(prospect.id);
    if (!draft) continue;
    add(prospect.created_at, "brouillon rédigé");
    if ((draft.quality_score ?? 0) >= 9 && !draft.quality_reason) add(prospect.created_at, "prêt (≥ 9/10)");
    else extra.aRevoir += 1;
  }
  const families = new Map<string, { eur: number; units: number }>();
  for (const row of input.usage) {
    const family = costFamily(row.service, row.operation);
    const entry = families.get(family) ?? { eur: 0, units: 0 };
    entry.eur += Number(row.cost) || 0;
    entry.units += Number(row.units) || 0;
    families.set(family, entry);
  }
  const cost = [...families.entries()].map(([family, value]) => ({ family, ...value })).sort((a, b) => b.eur - a.eur);
  return { days, byDay, totals, extra, cost };
}
