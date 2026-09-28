import { createHash } from "node:crypto";
import { collectSignals, type OfficialSignal } from "@/lib/signals";
import type { EnvLike } from "@/lib/signals/france-travail";
import type { EnrichmentWarning } from "@/lib/enrichment/types";
import type { FunnelSource, HarvestedSignal, Strength } from "./types";

/**
 * ÉTAGE 1 — moisson des signaux bruts. Gratuit : BODACC et France Travail.
 *
 * On réutilise les collecteurs de lib/signals (limiteurs de débit, cache,
 * écart des annonces négatives) et on les aplatit en signaux dédoublonnés.
 * Linkup (actualités) n'est pas branché ici : voir la PR.
 */

export const DEFAULT_FUNNEL_DAYS = 14;

/** Empreinte stable : même signal relu deux jours de suite = même ligne. */
export function signalHash(parts: { source: string; siren: string | null; companyName: string; date: string; text: string }): string {
  const key = [parts.source, parts.siren ?? parts.companyName.toLowerCase(), parts.date.slice(0, 10), parts.text.trim().toLowerCase()].join("|");
  return createHash("sha1").update(key).digest("hex");
}

const amount = (raw: string) => Number(raw.replace(/[\s .]/g, "").replace(",", "."));

/**
 * Capital AVANT l'opération, quand le texte le donne (« porté de 10 000,00 €
 * à 10 959,76 € »). BODACC ne publie que le capital d'après : sans cette
 * phrase, le montant de l'augmentation reste inconnu.
 */
export function parseCapitalChange(text: string): { before: number; after: number } | null {
  const match = text.match(
    /(?:port[ée]|augment[ée]|r[ée]duit)\s+de\s+([\d\s .,]+)\s*(?:€|eur(?:os)?)?\s+[àa]\s+([\d\s .,]+)\s*(?:€|eur(?:os)?)/i,
  );
  if (!match) return null;
  const before = amount(match[1]);
  const after = amount(match[2]);
  return Number.isFinite(before) && Number.isFinite(after) && before > 0 ? { before, after } : null;
}

const stripDate = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, "").replace(/^Recrutement\s*:\s*/, "").trim();

/** Un signal officiel (lib/signals) → un signal brut de l'entonnoir. */
export function fromOfficial(signal: OfficialSignal): HarvestedSignal {
  const main = signal.signals[0];
  const source: FunnelSource = signal.sourceId === "bodacc" ? "bodacc" : "france-travail";
  const text = (typeof main?.quote === "string" && main.quote) || main?.label || signal.companyName;
  const change = parseCapitalChange(text);
  const date = signal.date.slice(0, 10);
  const label = source === "france-travail" ? "Recrutement" : stripDate(main?.label ?? "Annonce BODACC");

  return {
    source,
    date,
    text,
    url: main?.url ?? null,
    siren: signal.siren,
    companyName: signal.companyName,
    facts: {
      label,
      signalType: main?.type ?? "presse",
      strength: signal.strength as Strength,
      capitalAfter: change?.after ?? signal.capitalAmount,
      capitalBefore: change?.before ?? null,
      newLeaders: signal.newLeaders,
      jobTitle: signal.jobTitle,
      city: signal.city,
      postalCode: signal.postalCode,
    },
    hash: signalHash({ source, siren: signal.siren, companyName: signal.companyName, date, text }),
  };
}

export interface HarvestCriteria {
  departements: readonly string[];
  days?: number;
  today?: Date;
  env?: EnvLike;
}

export interface Harvest {
  signals: HarvestedSignal[];
  warnings: EnrichmentWarning[];
  /** Signaux lus par source, avant dédoublonnage. */
  bySource: Record<string, number>;
}

/** Moisson sur plusieurs départements, dédoublonnée par empreinte. */
export async function harvest(criteria: HarvestCriteria): Promise<Harvest> {
  const days = criteria.days ?? DEFAULT_FUNNEL_DAYS;
  const seen = new Map<string, HarvestedSignal>();
  const warnings: EnrichmentWarning[] = [];
  const bySource: Record<string, number> = {};

  for (const departement of criteria.departements) {
    const collected = await collectSignals({ departement, tranches: [], limit: 0, days, today: criteria.today, env: criteria.env });
    warnings.push(...collected.warnings);
    for (const official of collected.signals) {
      const signal = fromOfficial(official);
      bySource[signal.source] = (bySource[signal.source] ?? 0) + 1;
      if (!seen.has(signal.hash)) seen.set(signal.hash, signal);
    }
  }
  return { signals: [...seen.values()], warnings, bySource };
}
