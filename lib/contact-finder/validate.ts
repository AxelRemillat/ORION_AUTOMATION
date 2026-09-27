import type { CompanyIdentity } from "./types";

/**
 * Un domaine n'est validé que si la page parle de CETTE entreprise.
 *
 * Preuves acceptées, de la plus forte à la plus faible :
 *   - le SIREN ou le SIRET (espacé ou non) → 90 ;
 *   - la raison sociale, avec la ville ou le code postal → 75 ;
 *   - la raison sociale seule → 60 ;
 *   - le nom du dirigeant ET la ville → 60.
 * Un nom commercial seul ne valide pas : « Boulangerie Bonnin » peut exister
 * ailleurs. Il ajoute des points, il ne prouve rien.
 */

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LEGAL_FORMS = /\b(sas|sasu|sarl|eurl|sa|snc|scop|sci|selarl|societe|ste|ets|etablissements?|groupe)\b/g;

/** « SARL BONNIN FRERES » → « bonnin freres ». */
export function coreName(name: string): string {
  return normalize(name).replace(LEGAL_FORMS, " ").replace(/\s+/g, " ").trim();
}

/** Le texte contient-il ces mots, dans l'ordre, sur des frontières de mots ? */
function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${haystack} `.includes(` ${phrase} `);
}

/** SIREN (9 chiffres) ou SIRET (14) en clair, même espacés « 421 882 440 ». */
export function containsSiren(text: string, siren: string | null): boolean {
  if (!siren) return false;
  const digits = text.replace(/[\s. -]/g, "");
  return digits.includes(siren.replace(/\s/g, ""));
}

export interface PageEvidence {
  confidence: number;
  validated: boolean;
  reason: string;
}

export function judgePage(text: string, company: CompanyIdentity): PageEvidence {
  const hay = normalize(text);
  const legal = coreName(company.legalName);
  // Si la raison sociale réduite tient dans un nom commercial (« bonnin
  // freres » dans « Boulangerie Bonnin Frères »), la trouver ne prouve rien de
  // plus que le nom commercial : on exige alors la raison sociale COMPLÈTE,
  // forme juridique comprise (« sarl bonnin freres »).
  const insideTrade = company.tradeNames.some((name) => containsPhrase(coreName(name), legal));
  const needle = insideTrade ? normalize(company.legalName) : legal;
  const hasLegal = legal.length >= 3 && containsPhrase(hay, needle);
  const place = [company.city, company.postalCode].filter((value): value is string => Boolean(value)).map(normalize);
  const hasPlace = place.some((value) => value.length >= 3 && containsPhrase(hay, value));
  const leader = company.leader ? normalize(company.leader.lastName) : "";
  const hasLeader = leader.length >= 3 && containsPhrase(hay, leader);
  const hasTrade = company.tradeNames.some((name) => {
    const core = coreName(name);
    return core.length >= 4 && containsPhrase(hay, core);
  });

  if (containsSiren(text, company.siren)) {
    return { confidence: 90, validated: true, reason: "SIREN présent sur la page" };
  }
  if (hasLegal && hasPlace) return { confidence: 75, validated: true, reason: "raison sociale et ville" };
  if (hasLegal) return { confidence: 60, validated: true, reason: "raison sociale" };
  if (hasLeader && hasPlace) return { confidence: 60, validated: true, reason: "dirigeant et ville" };
  if (hasTrade && hasPlace) return { confidence: 45, validated: false, reason: "nom commercial et ville (insuffisant seul)" };
  if (hasTrade || hasPlace) return { confidence: 20, validated: false, reason: "indice partiel" };
  return { confidence: 0, validated: false, reason: "aucune mention de l'entreprise" };
}
