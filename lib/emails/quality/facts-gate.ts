/**
 * PORTE « FAITS » avant rédaction (Cowork #31).
 *
 * Contrat d'agent1 : `key_figures.facts` = [{ text, source_url, page_kind,
 * distinctiveness 0-3, process_hint }] et `key_figures.facts_score` = max des
 * distinctiveness. 2 = propre à l'entreprise ET lié à un process ; 3 = idem +
 * citation vérifiable.
 *
 * Aucun fait à 2 ou plus → pas de rédaction (« Faits insuffisants »), aucun
 * coût, pas un échec. Fiche sans champ `facts` (anciennes fiches) :
 * comportement d'avant, rien n'est bloqué.
 */

export interface KeyFact {
  text: string;
  source_url: string | null;
  page_kind: string | null;
  distinctiveness: number;
  process_hint: string | null;
}

export const FACTS_MIN_DISTINCTIVENESS = 2;
export const FACTS_INSUFFICIENT = "Faits insuffisants";

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Faits de la fiche, du plus distinctif au moins distinctif ; `null` = champ absent (fiche d'avant). */
export function keyFactsOf(figures: Record<string, unknown> | null | undefined): KeyFact[] | null {
  const raw = figures?.facts;
  if (!Array.isArray(raw)) return null;
  return raw
    .map((item): KeyFact | null => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      const text = str(value.text);
      const level = Number(value.distinctiveness);
      if (!text || !Number.isFinite(level)) return null;
      return { text, source_url: str(value.source_url), page_kind: str(value.page_kind), distinctiveness: Math.max(0, Math.min(3, level)), process_hint: str(value.process_hint) };
    })
    .filter((fact): fact is KeyFact => Boolean(fact))
    .sort((a, b) => b.distinctiveness - a.distinctiveness);
}

export type FactsGate = { ok: true; facts: KeyFact[] | null } | { ok: false; reason: string };

export function factsGate(figures: Record<string, unknown> | null | undefined): FactsGate {
  const facts = keyFactsOf(figures);
  if (facts === null) return { ok: true, facts: null };
  if (!facts.some((fact) => fact.distinctiveness >= FACTS_MIN_DISTINCTIVENESS)) {
    return { ok: false, reason: `${FACTS_INSUFFICIENT} : aucun fait propre à l'entreprise et lié à un process (distinctivité ≥ ${FACTS_MIN_DISTINCTIVENESS}) — mail non rédigé.` };
  }
  return { ok: true, facts };
}

export const isFactsInsufficient = (reason: string | null | undefined) => Boolean(reason?.startsWith(FACTS_INSUFFICIENT));
