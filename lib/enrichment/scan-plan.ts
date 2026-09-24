/**
 * Plan de scan : quelles pages de l'annuaire lire, et jusqu'où insister.
 *
 * Deux défauts corrigés ici.
 *
 * 1. On ne demandait que la page 1, avec un tri stable. Deux recherches
 *    identiques rendaient donc exactement les mêmes entreprises, indéfiniment.
 *    On tire maintenant des pages au hasard — mais un hasard DÉTERMINISTE,
 *    dérivé des critères et de la date du jour : relancer la même recherche
 *    dans la journée redonne le même plan (pas de double dépense), et le
 *    lendemain en donne un autre.
 *
 * 2. Le scan s'arrêtait après une seule salve, même quand il n'avait trouvé
 *    aucun signal. On enchaîne désormais les lots jusqu'à l'objectif, avec un
 *    plafond dur — sans lui, une zone pauvre en signaux ferait tourner Linkup
 *    jusqu'à épuisement du budget.
 */

/** Pourquoi la boucle s'est arrêtée. Affiché tel quel dans l'UI. */
export type ScanStop = "objectif" | "plafond" | "annuaire";

export const STOP_LABELS: Record<ScanStop, string> = {
  objectif: "objectif atteint",
  plafond: "plafond de scan atteint",
  annuaire: "toutes les pages de l'annuaire ont été lues",
};

/**
 * Plafond de pages lisibles en une recherche.
 *
 * Il ne sert qu'a borner la memoire du plan : ce sont l'objectif et le budget
 * de scan qui arretent reellement la boucle, bien avant. Il est volontairement
 * large.
 */
export const MAX_PLAN_PAGES = 60;

/**
 * Nombre de pages a prevoir dans le plan.
 *
 * Premiere version : `budget / largeur * 2 + 3`, soit 9 pages pour un budget
 * de 60. Erreur de raisonnement — elle supposait qu'une page rapporte environ
 * une pleine largeur de candidats. Avec la deduplication, une page peut n'en
 * rapporter aucun : sur Paris, 56 entreprises ont ete ecartees et le scan
 * s'est arrete a 42 entreprises sur un budget de 60, en annoncant « plus de
 * pages a lire » alors qu'il en restait une centaine.
 *
 * Le plan couvre donc TOUTES les pages atteignables (bornees par
 * `MAX_PLAN_PAGES`). Le cout reste tenu par le budget de scan, pas par la
 * longueur du plan.
 */
export function plannedPages(available: number): number {
  return Math.max(1, Math.min(available, MAX_PLAN_PAGES));
}

/**
 * Multiplicateur du garde-fou de coût : on s'autorise à scanner jusqu'à 3 fois
 * la largeur demandée pour atteindre l'objectif, jamais plus.
 */
export const SCAN_BUDGET_FACTOR = 3;

export function scanBudget(scanWidth: number): number {
  return Math.max(1, Math.round(scanWidth * SCAN_BUDGET_FACTOR));
}

/**
 * Graine d'une recherche : mêmes critères + même jour = même plan.
 *
 * La date est incluse au jour près (et non à l'heure) pour que deux clics
 * successifs ne repaient pas deux fois la même exploration.
 */
export function searchSeed(parts: (string | number | undefined | null)[], today: string): number {
  const material = [...parts.map((part) => String(part ?? "")), today].join("|");
  let hash = 2_166_136_261;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Générateur congruentiel : suffisant pour choisir des pages, et reproductible. */
function* pseudoRandom(seed: number): Generator<number> {
  let state = seed || 1;
  while (true) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    yield state / 4_294_967_296;
  }
}

/**
 * Ordre de visite des pages, sans répétition.
 *
 * La page 1 reste en tête : c'est là que l'annuaire place les entreprises les
 * mieux renseignées, et une première recherche doit rendre quelque chose de
 * bon. Les suivantes sont mélangées par la graine.
 */
export function pagePlan(seed: number, pages: number, wanted: number): number[] {
  const total = Math.max(1, pages);
  const rest = Array.from({ length: total - 1 }, (_, index) => index + 2);
  const random = pseudoRandom(seed);

  // Fisher-Yates piloté par la graine.
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random.next().value * (index + 1));
    [rest[index], rest[swap]] = [rest[swap], rest[index]];
  }

  // Le décalage évite que toute recherche commence systématiquement par la
  // page 1 : une seule entreprise nouvelle par jour, sinon.
  const startAtOne = Math.floor(random.next().value * 2) === 0 || total === 1;
  const ordered = startAtOne ? [1, ...rest] : [...rest.slice(0, 1), 1, ...rest.slice(1)];
  return ordered.slice(0, Math.max(1, wanted));
}

export interface LoopState {
  /** Candidats retenus (non exclus) et effectivement passés au scan. */
  scanned: number;
  /** Entreprises porteuses d'au moins un signal attesté. */
  withSignal: number;
  /** Pages déjà lues. */
  pagesRead: number;
}

/** Faut-il lancer un lot de plus ? */
export function shouldContinue(
  state: LoopState,
  goal: number,
  budget: number,
  pagesAvailable: number,
): { go: boolean; stop: ScanStop } {
  if (state.withSignal >= goal) return { go: false, stop: "objectif" };
  if (state.scanned >= budget) return { go: false, stop: "plafond" };
  if (state.pagesRead >= pagesAvailable) return { go: false, stop: "annuaire" };
  return { go: true, stop: "objectif" };
}

export interface Candidate {
  siren: string | null;
  company_name: string;
}

export interface FilterResult<T> {
  kept: T[];
  /** Ecartees parce que deja en portefeuille, en favori, ou deja scannees. */
  skippedKnown: number;
}

/**
 * Ecarte ce qu'on a deja vu.
 *
 * `seen` est mute : il porte la memoire DE CETTE recherche, pour qu'une
 * entreprise presente sur deux pages ne soit pas scannee deux fois. `exclude`
 * vient de la base et n'est jamais modifie.
 *
 * Une entreprise sans SIREN est conservee : on ne peut pas prouver qu'elle est
 * un doublon, et la perdre serait pire que la scanner une fois de trop.
 */
export function filterCandidates<T extends Candidate>(
  companies: readonly T[],
  options: { exclude: ReadonlySet<string>; seen: Set<string> },
): FilterResult<T> {
  const kept: T[] = [];
  let skippedKnown = 0;

  for (const company of companies) {
    const siren = company.siren;
    if (!siren) {
      kept.push(company);
      continue;
    }
    if (options.seen.has(siren)) continue;
    options.seen.add(siren);
    if (options.exclude.has(siren)) {
      skippedKnown += 1;
      continue;
    }
    kept.push(company);
  }

  return { kept, skippedKnown };
}
