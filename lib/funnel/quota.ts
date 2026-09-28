import type { TriageOutcome } from "./triage";

/**
 * QUOTA PAR TYPE DE SIGNAL.
 *
 * Mesuré le 28/09/2026 sur le run 69+31 : les DIX fiches retenues étaient des
 * « reprise de fonds de commerce ». Ce n'est pas une préférence du marché, c'est
 * un effet du tri : ce type coche toutes les cases du prompt (changement récent,
 * engageant, sujet clair), donc il rafle tout, et une journée de prospection se
 * résume à des rachats de commerces.
 *
 * On plafonne donc chaque type à 40 % des retenus. Au-delà, les signaux
 * excédentaires du type dominant sont écartés — avec leur raison, pour qu'on
 * puisse la relire — et la place revient aux autres types, par score décroissant.
 *
 * Le plafond ne s'applique pas quand il n'y a rien d'autre : un run qui ne
 * trouve que trois signaux du même type les garde tous les trois. Un quota qui
 * viderait la liste ne rendrait service à personne.
 */

export const MAX_SHARE_PER_TYPE = 0.4;

/** Au-dessous de ce nombre de retenus, le quota ne s'applique pas. */
export const QUOTA_FLOOR = 5;

/** Score plancher d'un signal promu pour la variété (le seuil normal est 4). */
export const PROMOTE_SCORE = 3;

const typeOf = (outcome: TriageOutcome) => outcome.triage?.type?.trim().toLowerCase() || "autre";

/**
 * Applique le quota aux signaux retenus, du meilleur score au moins bon.
 *
 * Rend les MÊMES éléments, certains basculés en `retained: false` avec leur
 * raison. Rien n'est supprimé : l'écran du run montre ce qui a été écarté et
 * pourquoi.
 */
export function applyTypeQuota(outcomes: readonly TriageOutcome[]): TriageOutcome[] {
  const retained = outcomes.filter((item) => item.retained);
  if (retained.length < QUOTA_FLOOR) return [...outcomes];

  const cap = Math.max(1, Math.floor(retained.length * MAX_SHARE_PER_TYPE));
  const byScore = (a: TriageOutcome, b: TriageOutcome) => (b.triage?.score ?? 0) - (a.triage?.score ?? 0);

  // Qui dépasse le plafond, du meilleur score au moins bon.
  const counts = new Map<string, number>();
  const kept = new Set<string>();
  const surplus: TriageOutcome[] = [];
  for (const outcome of [...retained].sort(byScore)) {
    const type = typeOf(outcome);
    const seen = counts.get(type) ?? 0;
    if (seen >= cap) {
      surplus.push(outcome);
      continue;
    }
    counts.set(type, seen + 1);
    kept.add(outcome.id);
  }
  if (!surplus.length) return [...outcomes];

  /*
   * ON NE RETIRE QUE CE QU'ON PEUT REMPLACER.
   *
   * Plafonner sans promouvoir ne crée pas de variété : ça raccourcit la liste.
   * Le 28/09/2026, les six retenus étaient tous des « reprise de fonds de
   * commerce » ; appliquer le plafond seul aurait rendu deux fiches au lieu de
   * six, sans rien diversifier.
   *
   * On cherche donc d'abord les remplaçants — les meilleurs signaux des AUTRES
   * types, jusqu'à un score de 3, un cran sous le seuil normal — puis on ne
   * retire du type dominant que le nombre qu'on sait remplacer.
   */
  const replacements = outcomes
    .filter((item) => !item.retained && !kept.has(item.id))
    .filter((item) => item.triage?.utilisable && item.triage.sujet_est_l_entreprise)
    .filter((item) => (item.triage?.score ?? 0) >= PROMOTE_SCORE)
    .sort(byScore);

  const promoted: TriageOutcome[] = [];
  for (const candidate of replacements) {
    if (promoted.length >= surplus.length) break;
    const type = typeOf(candidate);
    if ((counts.get(type) ?? 0) >= cap) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
    promoted.push(candidate);
  }

  // Aucun remplaçant : on ne retire rien. `slice(-0)` rendrait TOUT le tableau —
  // le premier essai vidait la liste de 45 à 18 sur un run mono-type.
  if (!promoted.length) return [...outcomes];

  // Les surnuméraires les moins bien notés cèdent leur place, et seulement eux.
  const removed = new Set(surplus.slice(-promoted.length).map((item) => item.id));
  const promotedIds = new Set(promoted.map((item) => item.id));

  return outcomes.map((outcome) => {
    if (promotedIds.has(outcome.id)) {
      return { ...outcome, retained: true, reason: `retenu pour la variété : type « ${typeOf(outcome)} » absent des premiers` };
    }
    if (removed.has(outcome.id)) {
      return { ...outcome, retained: false, reason: `quota de variété : déjà ${cap} signaux « ${typeOf(outcome)} » sur ce run` };
    }
    return outcome;
  });
}
