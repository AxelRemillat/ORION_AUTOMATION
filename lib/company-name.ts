/**
 * UN SEUL NOM quand le sigle répète la dénomination.
 *
 * L'annuaire public (recherche-entreprises, champ `nom_complet`) accole le
 * sigle entre parenthèses : « GLOBAL 2F (GLOBAL 2F) ». Stocké tel quel, ce nom
 * s'affichait en double et partait au générateur, qui a écrit « Global 2F
 * Global 2F » dans un mail.
 *
 * On ne retire la parenthèse que si elle RÉPÈTE le nom (casse, accents,
 * ponctuation et forme juridique mis à part). Un vrai sigle, différent du nom,
 * reste : « SOCIETE NATIONALE DES CHEMINS DE FER (SNCF) » est une information.
 *
 * Module pur : serveur, client et tests.
 */

const LEGAL_FORMS = /\b(sas|sasu|sarl|eurl|sa|snc|scop|sci|selarl|scea|earl|gaec)\b/g;

function comparable(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TRAILING_PARENTHESIS = /^(.*?)\s*\(([^()]*)\)\s*$/;

export function singleCompanyName(name: string): string;
export function singleCompanyName(name: string | null | undefined): string | null;
export function singleCompanyName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  const match = TRAILING_PARENTHESIS.exec(trimmed);
  if (!match) return trimmed;
  const [, outer, inner] = match;
  const same = comparable(outer) !== "" && comparable(outer) === comparable(inner);
  return same ? outer.trim() : trimmed;
}
