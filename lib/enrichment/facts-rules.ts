import type { SourcedFact } from "./facts";

/**
 * RÈGLES DÉTERMINISTES de `distinctiveness` (Cowork #37, 07/10/2026) — le
 * modèle notait trop large : 20 fiches sur 22 à 2 ou 3. Rejouées sur les faits
 * stockés, sans aucun appel LLM.
 *
 *   - 3 seulement si l'extrait porte une PREUVE : un chiffre, un nom propre
 *     (produit, client, marque, site, ville) ou un verbe de process explicite
 *     (devis, commande, livraison, planning, intervention, rendez-vous,
 *     facture, réclamation, dossier) ; sinon plafond 2. Le nom de
 *     l'entreprise elle-même ne compte pas comme nom propre ;
 *   - plafond 1 si le fait ne fait que paraphraser l'activité (libellé NAF) ;
 *   - sans tâche répétitive identifiée (`process_hint`), plafond 1 (règle d'origine).
 */

const PROCESS = /\b(devis|commandes?|livraisons?|livr[ée]|planning|plannings|interventions?|rendez-vous|rdv|factur\w*|r[ée]clamations?|dossiers?)\b/i;

/** Mots en capitale qui ne sont PAS des noms propres (début de phrase, pronoms, articles…). */
const COMMON_CAPITALIZED = new Set(
  "le la les l un une des du de d nous notre nos vous votre vos ils elles il elle on ce cet cette ces chaque tous toutes tout pour par avec dans sur en au aux et ou mais si plus depuis grâce afin the a an our we you your for with in on at to of and from this that each all new".split(" "),
);

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** L'extrait contient-il un chiffre ? */
export const hasNumber = (text: string) => /\d/.test(text);

/**
 * L'extrait contient-il un nom propre ? Un mot à majuscule qui n'ouvre pas une
 * phrase et n'est pas un mot courant, ou un sigle (ISO, ADV, SNCF).
 */
export function hasProperNoun(text: string, company?: string | null): boolean {
  // Le nom de l'entreprise elle-même n'est pas une preuve (« Instan, c'est… »).
  const own = new Set(fold(company ?? "").split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
  const words = text.split(/\s+/);
  for (let index = 0; index < words.length; index += 1) {
    const raw = words[index].replace(/^[«"“(‘'’]+|[»"”).,;:!?’']+$/g, "");
    if (!raw) continue;
    if (/^[A-ZÀ-Ý]{2,}[0-9]*$/.test(raw) && raw.length <= 8 && !own.has(fold(raw))) return true; // sigle
    if (!/^[A-ZÀ-Ý][a-zà-ÿ]/.test(raw)) continue;
    const sentenceStart = index === 0 || /[.!?:]$/.test(words[index - 1] ?? "");
    if (sentenceStart) continue;
    if (COMMON_CAPITALIZED.has(fold(raw))) continue;
    if (own.has(fold(raw).replace(/[^a-z0-9]/g, ""))) continue;
    return true;
  }
  return false;
}

export const hasProcessVerb = (text: string) => PROCESS.test(text);

const STOP = new Set(
  "pour avec dans nous notre vous votre leurs leur sont etre avoir plus tres tous toutes depuis entre chez ainsi autres autre services service activite activites entreprise societe clients client offre offrons proposons travaux".split(" "),
);
const words = (text: string) =>
  fold(text)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP.has(word));

/**
 * Le fait ne fait-il que redire l'activité (libellé NAF / secteur) ? Tous ses
 * mots significatifs, sauf un au plus, figurent déjà dans le libellé.
 */
export function paraphrasesActivity(text: string, activity: string | null | undefined): boolean {
  if (!activity) return false;
  const known = new Set(words(activity).map((word) => word.replace(/s$/, "")));
  const own = words(text).map((word) => word.replace(/s$/, ""));
  if (own.length === 0) return true;
  return own.filter((word) => !known.has(word)).length <= 1;
}

/** Niveau retenu pour un fait, d'après les règles. N'augmente jamais le niveau du modèle. */
export function ruledDistinctiveness(fact: Pick<SourcedFact, "text" | "distinctiveness" | "process_hint">, activity?: string | null, company?: string | null): 0 | 1 | 2 | 3 {
  let level = Math.max(0, Math.min(3, Math.round(Number(fact.distinctiveness) || 0))) as 0 | 1 | 2 | 3;
  if (!fact.process_hint && level > 1) level = 1;
  const proper = hasProperNoun(fact.text, company);
  if (level === 3 && !(hasNumber(fact.text) || proper || hasProcessVerb(fact.text))) level = 2;
  if (level > 1 && !hasNumber(fact.text) && !proper && paraphrasesActivity(fact.text, activity)) level = 1;
  return level;
}

/** Faits recalculés (niveaux plafonnés, ordre du plus distinctif au moins distinctif) et score. */
export function rescoreFacts(facts: readonly SourcedFact[], activity?: string | null, company?: string | null): { facts: SourcedFact[]; score: 0 | 1 | 2 | 3 } {
  const ruled = facts.map((fact) => ({ ...fact, distinctiveness: ruledDistinctiveness(fact, activity, company) })).sort((a, b) => b.distinctiveness - a.distinctiveness);
  const score = ruled.reduce<0 | 1 | 2 | 3>((best, fact) => (fact.distinctiveness > best ? fact.distinctiveness : best), 0);
  return { facts: ruled, score };
}
