import { TODAY_KINDS, type TodayKind } from "@/types";
import { isComplete } from "./tags";
import { GROUP_LABELS, type TodayGroup, type TodayItem } from "./types";

/**
 * Répartition de la file du jour en quatre groupes, dans CET ordre :
 *
 *   1. Réponses à traiter — quelqu'un attend, c'est le plus chaud ;
 *   2. Relances du jour   — le fil est déjà ouvert, l'échéance est aujourd'hui ;
 *   3. Nouveaux prospects — complets (signal + contact + brouillon), par score ;
 *   4. À compléter        — il manque un email, une vérification ou le brouillon.
 *
 * Code pur : la règle d'ordre et d'exclusion se teste sans base.
 */

/** Un élément avant répartition, avec ce qu'il faut pour trier et exclure. */
export interface RawTodayItem extends TodayItem {
  /**
   * Motif d'exclusion : opposé à la prospection, « ne plus contacter », hors
   * cible, écarté, à la corbeille. Un élément exclu n'apparaît dans AUCUN groupe.
   */
  exclusion: string | null;
  /** Tri des réponses : la plus ancienne d'abord (elle attend depuis le plus longtemps). */
  receivedAt?: string | null;
  /** Tri des relances : l'échéance la plus ancienne d'abord. */
  dueAt?: string | null;
  /** Départage des nouveaux à score égal : le poids du filtre de l'entonnoir. */
  weight?: number | null;
}

const byDate = (a?: string | null, b?: string | null) => (a ?? "").localeCompare(b ?? "");

/** Mail prêt : noté ≥ 9 par le juge qualité. */
export const READY_QUALITY = 9;

/**
 * À QUALITÉ ÉGALE, LE NOMINATIF D'ABORD (06/10/2026) : parmi les mails prêts
 * (≥ 9) — et de même parmi les autres —, une adresse nominative passe avant
 * une générique. Sert à « Nouveaux » et au remplissage du quota d'envoi.
 */
export function nominativeFirst(a: Pick<TodayItem, "quality" | "contact">, b: Pick<TodayItem, "quality" | "contact">): number {
  const ready = (item: Pick<TodayItem, "quality">) => ((item.quality ?? 0) >= READY_QUALITY ? 0 : 1);
  const generic = (item: Pick<TodayItem, "contact">) => (item.contact.kind === "nominatif" ? 0 : 1);
  return ready(a) - ready(b) || generic(a) - generic(b);
}

/** Le groupe d'un élément de prospection dépend de sa complétude. */
export function kindOf(item: RawTodayItem): TodayKind {
  if (item.kind === "reponse" || item.kind === "relance") return item.kind;
  return isComplete(item.tags, Boolean(item.messageId)) ? "nouveau" : "a_completer";
}

const COMPARE: Record<TodayKind, (a: RawTodayItem, b: RawTodayItem) => number> = {
  reponse: (a, b) => byDate(a.receivedAt, b.receivedAt),
  relance: (a, b) => byDate(a.dueAt, b.dueAt),
  nouveau: (a, b) => nominativeFirst(a, b) || (b.score ?? -1) - (a.score ?? -1) || (b.weight ?? 0) - (a.weight ?? 0),
  a_completer: (a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.weight ?? 0) - (a.weight ?? 0),
};

export function groupToday(raw: readonly RawTodayItem[]): TodayGroup[] {
  const buckets = new Map<TodayKind, RawTodayItem[]>(TODAY_KINDS.map((kind) => [kind, []]));
  const seen = new Set<string>();

  for (const item of raw) {
    if (item.exclusion) continue;
    // Une même fiche ne figure qu'une fois : la réponse prime sur la relance,
    // la relance sur l'intro (ordre d'arrivée, déjà trié par le chargeur).
    const owner = item.prospectId ?? item.key;
    if (item.kind !== "reponse" && seen.has(owner)) continue;
    seen.add(owner);
    const kind = kindOf(item);
    buckets.get(kind)!.push({ ...item, kind });
  }

  return TODAY_KINDS.map((kind) => ({
    kind,
    label: GROUP_LABELS[kind],
    items: [...buckets.get(kind)!].sort(COMPARE[kind]).map(strip),
  })).filter((group) => group.items.length > 0);
}

/** Retire les clés de tri : l'écran reçoit des `TodayItem`. */
function strip(item: RawTodayItem): TodayItem {
  const { exclusion: _exclusion, receivedAt: _received, dueAt: _due, weight: _weight, ...rest } = item;
  return rest;
}

/** La file à plat, dans l'ordre d'affichage : c'est l'ordre de ↓ / ↑. */
export const flatten = (groups: readonly TodayGroup[]): TodayItem[] => groups.flatMap((group) => group.items);

/**
 * Élément suivant à traiter après une décision : le prochain « à relire »
 * APRÈS la position courante, en revenant au début si besoin. S'il n'en reste
 * aucun, la sélection ne bouge pas.
 */
export function nextTodo(items: readonly Pick<TodayItem, "status">[], from: number): number {
  for (let step = 1; step <= items.length; step += 1) {
    const index = (from + step) % items.length;
    if (items[index].status === "todo") return index;
  }
  return from;
}
