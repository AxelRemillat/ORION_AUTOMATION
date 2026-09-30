import type { TriageOutcome } from "./triage";
import { painForJob } from "./pain-map";
import type { HarvestedSignal } from "./types";

/**
 * QUOTA PAR TYPE DE SIGNAL — appliqué à la LISTE FINALE des retenus.
 *
 * Mesuré le 28/09/2026 sur le run 69+31 : les DIX fiches retenues étaient des
 * « reprise de fonds de commerce ». Le 30/09 (69, 38, 42, 01, 73, 74), encore
 * 11 sur 13. La première version ne retirait que ce qu'elle savait remplacer :
 * sans remplaçant, rien ne bougeait, et le plafond restait théorique.
 *
 * Désormais :
 *   1. on promeut d'abord les meilleurs signaux des AUTRES types (score ≥ 3,
 *      un cran sous le seuil normal), pour ne pas raccourcir la liste pour rien ;
 *   2. puis on applique le plafond POUR DE BON : aucun type ne dépasse 40 % des
 *      retenus finaux. Les surnuméraires les moins bien notés sont écartés, avec
 *      leur raison, même si la liste raccourcit.
 *
 * Le type est celui du SIGNAL (reprise, direction, capital, recrutement…), pas
 * l'étiquette libre du modèle : « reprise », « croissance » ou « implantation »
 * pour la même reprise de fonds de commerce échappaient au plafond.
 *
 * Sous 5 retenus au départ, le quota ne s'applique pas : trois signaux du même
 * type restent trois signaux. Et un type garde toujours au moins UNE fiche :
 * sans cette borne, une liste d'un seul type fondrait jusqu'à zéro.
 */

export const MAX_SHARE_PER_TYPE = 0.4;

/** Au-dessous de ce nombre de retenus (avant quota), le quota ne s'applique pas. */
export const QUOTA_FLOOR = 5;

/** Score plancher d'un signal promu pour la variété (le seuil normal est 4). */
export const PROMOTE_SCORE = 3;

/** Famille d'un signal, pour le quota : stable d'une source et d'un libellé à l'autre. */
export function signalFamily(signal: Pick<HarvestedSignal, "source" | "facts">): string {
  // Une offre ADV et une offre de comptable ne sont pas « le même type » : le
  // poste distingue les offres entre elles.
  if (signal.source === "france-travail") return `recrutement · ${painForJob(signal.facts.jobTitle ?? "") ?? "autre poste"}`;
  const label = `${signal.facts.label ?? ""}`.toLowerCase();
  if (/fonds de commerce|reprise|cession/.test(label)) return "reprise de fonds";
  if (/capital/.test(label)) return "capital";
  if (/devient|nomm|dirigeant|g[ée]rant|pr[ée]sident|directeur/.test(label)) return "direction";
  if (/cr[ée]ation|immatriculation|[ée]tablissement|transfert|si[èe]ge/.test(label)) return "implantation";
  return signal.facts.signalType || "autre";
}

type FamilyOf = (outcome: TriageOutcome) => string;

const byScore = (a: TriageOutcome, b: TriageOutcome) => (b.triage?.score ?? 0) - (a.triage?.score ?? 0);

/**
 * Applique le quota. Rend les MÊMES éléments, certains basculés : promus
 * (`retained: true` + `note`), ou écartés (`retained: false` + `reason`).
 * Rien n'est supprimé : l'écran du run montre ce qui a été écarté et pourquoi.
 */
export function applyTypeQuota(outcomes: readonly TriageOutcome[], familyOf: FamilyOf): TriageOutcome[] {
  const initial = outcomes.filter((item) => item.retained);
  if (initial.length < QUOTA_FLOOR) return [...outcomes];

  const state = new Map(outcomes.map((outcome) => [outcome.id, { ...outcome }]));
  const retained = () => [...state.values()].filter((item) => item.retained);
  const share = (family: string) => {
    const list = retained();
    return list.length ? list.filter((item) => familyOf(item) === family).length / list.length : 0;
  };

  // 1. Promotions : les meilleurs des autres types, tant qu'un type dépasse le plafond.
  const candidates = [...state.values()]
    .filter((item) => !item.retained && item.triage?.utilisable && item.triage.sujet_est_l_entreprise)
    .filter((item) => (item.triage?.score ?? 0) >= PROMOTE_SCORE && !/pain générique/.test(item.reason ?? ""))
    .sort(byScore);
  for (const candidate of candidates) {
    const counts = new Map<string, number>();
    for (const item of retained()) counts.set(familyOf(item), (counts.get(familyOf(item)) ?? 0) + 1);
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!dominant || dominant[1] / retained().length <= MAX_SHARE_PER_TYPE) break;
    const family = familyOf(candidate);
    if (family === dominant[0]) continue;
    // Promouvoir ne doit pas faire dépasser le plafond à SON propre type.
    if (((counts.get(family) ?? 0) + 1) / (retained().length + 1) > MAX_SHARE_PER_TYPE) continue;
    state.set(candidate.id, {
      ...candidate,
      retained: true,
      reason: null,
      note: `retenu pour la variété : type « ${family} » sous-représenté`,
    });
  }

  // 2. Plafond STRICT : le type dominant perd ses moins bien notés jusqu'à 40 %.
  for (;;) {
    const list = retained();
    const counts = new Map<string, TriageOutcome[]>();
    for (const item of list) counts.set(familyOf(item), [...(counts.get(familyOf(item)) ?? []), item]);
    const over = [...counts.entries()].find(([family, items]) => items.length > 1 && share(family) > MAX_SHARE_PER_TYPE);
    if (!over) break;
    const [family, items] = over;
    const weakest = [...items].sort(byScore).at(-1)!;
    state.set(weakest.id, {
      ...weakest,
      retained: false,
      note: undefined,
      reason: `quota de variété : type « ${family} » limité à ${Math.round(MAX_SHARE_PER_TYPE * 100)} % des retenus`,
    });
  }

  return outcomes.map((outcome) => state.get(outcome.id)!);
}
