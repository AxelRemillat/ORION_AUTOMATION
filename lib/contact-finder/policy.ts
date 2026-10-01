import { digFactsOf, disqualify } from "@/lib/funnel/eligible";

/**
 * FEU VERT HUNTER pour une fiche — décidé AVANT toute recherche payante.
 *
 * 01/10/2026 : un run a épuisé les crédits Hunter, dont une partie sur des
 * fiches qui allaient être écartées (ATMB, ADJUVOO, TÉRÉVA) — notamment par la
 * reprise des fiches « à compléter », qui relançait la recherche de contact
 * sans revérifier la fiche avec les règles du jour. Hunter n'est donc appelé
 * que sur une fiche :
 *
 *  1. qui a un SCORE d'entonnoir ≥ 4 (quand elle vient de l'entonnoir) ;
 *  2. dont le registre a été LU (opposition et taille vérifiables) quand elle
 *     vient de l'entonnoir — sans Pappers, ni l'une ni l'autre n'est connue ;
 *  3. qui ne serait pas ÉCARTÉE : opposition à la prospection, aucun salarié,
 *     plus de 249 salariés, filiale de grand groupe ou de groupe étranger,
 *     capitaux propres sous le seuil d'alerte (`disqualify`).
 *
 * Une fiche créée à la main (pas de `funnel_run_id`) garde Hunter si rien ne
 * l'exclut : c'est l'utilisateur qui l'a choisie.
 *
 * Le budget du jour et les crédits restants sont vérifiés à part, par le
 * garde-fou (lib/hunter/gate.ts), au moment de l'appel.
 */

export const MIN_HUNTER_SCORE = 4;

export type HunterPolicy = { allowed: true } | { allowed: false; reason: string };

export function hunterPolicy(figures: Record<string, unknown> | null | undefined): HunterPolicy {
  const facts = figures ?? {};
  const fromFunnel = typeof facts.funnel_run_id === "string" && facts.funnel_run_id !== "";
  const score = typeof facts.funnel_score === "number" ? facts.funnel_score : null;

  if (score !== null && score < MIN_HUNTER_SCORE) {
    return { allowed: false, reason: `score ${score}/5, Hunter réservé aux fiches ≥ ${MIN_HUNTER_SCORE}` };
  }
  if (fromFunnel && facts.pappers_read !== true) {
    return { allowed: false, reason: "registre non lu : opposition et taille non vérifiables" };
  }
  const verdict = disqualify(digFactsOf(facts));
  if (verdict) return { allowed: false, reason: `fiche à écarter (${verdict.reason})` };
  return { allowed: true };
}
