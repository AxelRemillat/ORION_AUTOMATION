import type { ContactResult } from "@/lib/contact-finder";
import type { CompanyBase, EnrichedCompany } from "@/lib/enrichment/types";
import type { ProspectSignal } from "@/types";
import { disqualify } from "./eligible";
import type { HarvestedSignal, Triage } from "./types";

/**
 * ÉTAGE 4 — creusage payant, UNIQUEMENT sur les signaux retenus, par score
 * décroissant, plafonné. Pappers → fiche, module contact, brief stratège.
 *
 * Une fiche n'est publiée dans « Prospects prêts » que si un email est trouvé ;
 * sinon elle part dans « À compléter ». Les dépendances sont injectées : le
 * test déroule tout l'étage sans réseau.
 */

export const DEFAULT_DIG_LIMIT = 15;
export const MAX_DIG_LIMIT = 20;

export interface DigCandidate {
  id: string;
  signal: HarvestedSignal;
  base: CompanyBase;
  triage: Triage;
  weight: number;
}

export type CreateOutcome = { id: string } | { existing: true } | { error: string };

export interface DigDeps {
  enrich: (candidate: DigCandidate) => Promise<EnrichedCompany>;
  createProspect: (company: EnrichedCompany, candidate: DigCandidate) => Promise<CreateOutcome>;
  findContact: (prospectId: string) => Promise<ContactResult>;
  /** Brief du stratège ; un échec n'empêche pas la publication. */
  brief: (prospectId: string) => Promise<void>;
}

export interface DigOutcome {
  id: string;
  /**
   * Renoncement DÉLIBÉRÉ, avec sa raison : opposition à la prospection,
   * capitaux propres sous le seuil d'alerte. Ce n'est pas un échec — rien n'a
   * raté — et ça ne doit pas se lire comme tel dans le bandeau du run.
   */
  skipped?: string | null;
  prospectId: string | null;
  contact: ContactResult | null;
  publication: "pret" | "a_completer" | null;
  error: string | null;
}

export const clampDigLimit = (value: unknown) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_DIG_LIMIT, parsed)) : DEFAULT_DIG_LIMIT;
};

/** Meilleur score d'abord, puis le poids du filtre. */
export function digOrder<T extends { triage: Triage; weight: number }>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) => b.triage.score - a.triage.score || b.weight - a.weight);
}

/** Le signal de l'entonnoir, au format de la fiche prospect (daté, sourcé). */
export function toProspectSignal(signal: HarvestedSignal): ProspectSignal {
  return {
    type: signal.facts.signalType,
    label: signal.facts.label,
    url: signal.url ?? undefined,
    date: signal.date,
    source: signal.source === "bodacc" ? "BODACC" : "France Travail",
    dateBasis: "source",
    confidence: signal.source === "bodacc" ? 0.98 : 0.9,
    strength: signal.facts.strength,
    quote: signal.text,
  };
}

/** Badge contact de la carte. */
export function contactBadge(contact: ContactResult | null): "nominatif" | "generique" | "aucun" {
  if (!contact?.email) return "aucun";
  return contact.email_type === "generique" ? "generique" : "nominatif";
}

export async function digOne(deps: DigDeps, candidate: DigCandidate): Promise<DigOutcome> {
  const base = { id: candidate.id, prospectId: null, contact: null, publication: null };
  try {
    const company = await deps.enrich(candidate);

    /*
     * DERNIER CONTRÔLE AVANT PUBLICATION.
     *
     * L'enrichissement vient de lire la fiche Pappers : c'est le premier moment
     * où l'on sait qu'une entreprise s'oppose à la prospection, ou que ses
     * capitaux propres sont tombés sous la moitié de son capital. On renonce
     * ICI, avant de créer la fiche et avant de dépenser la recherche de contact.
     */
    const figures = company.key_figures ?? {};
    const verdict = disqualify({
      refusesProspecting: figures.refuses_prospecting === true,
      noStaff: figures.no_staff === true,
      capitalEur: typeof figures.capital_eur === "number" ? figures.capital_eur : null,
      equityEur: typeof figures.equity_eur === "number" ? figures.equity_eur : null,
    });
    if (verdict) return { ...base, skipped: verdict.reason, error: null };

    const created = await deps.createProspect(company, candidate);
    if ("error" in created) return { ...base, error: `fiche non créée : ${created.error}` };
    if ("existing" in created) return { ...base, error: "déjà en portefeuille" };

    const contact = await deps.findContact(created.id);
    await deps.brief(created.id).catch(() => undefined);
    return {
      id: candidate.id,
      prospectId: created.id,
      contact,
      publication: contact.email ? "pret" : "a_completer",
      error: null,
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : "creusage impossible" };
  }
}
