/**
 * FILIALE DE GROUPE — la décision se prend ailleurs, l'entreprise n'est pas
 * une PME autonome. Badge « filiale de groupe », score plafonné à 3.
 *
 * 02/10/2026 : MAVIFLEX (328025721) a pour dirigeant Christoph Hörmann — le
 * groupe Hörmann — et passait pour une PME indépendante notée 5/5. Code pur :
 * il lit les chiffres clés déjà enregistrés, sans appel réseau, ce qui vaut
 * aussi pour les fiches déjà en base.
 *
 * Indices, du plus sûr au plus large :
 *   1. drapeaux du registre déjà posés : société mère étrangère, grand groupe ;
 *   2. dirigeant, société mère ou groupe portant le nom d'un GROUPE FAMILIAL
 *      CONNU (dirigeant commun avec le groupe) ;
 *   3. dirigeant PERSONNE MORALE (société) sans aucun dirigeant personne
 *      physique retrouvé : l'entreprise est tenue par une autre société, pas
 *      par son patron. Une holding personnelle (ARTFLEX → LLED, dirigeant
 *      Jean-Pierre Romeo) n'est PAS une filiale de groupe.
 */

export const SUBSIDIARY_SCORE_CAP = 3;

/**
 * Groupes familiaux dont le nom suffit : un dirigeant qui le porte signe un
 * dirigeant commun avec le groupe. Noms distinctifs seulement — pas de
 * patronyme courant, qui ferait des faux positifs.
 */
export const KNOWN_GROUP_FAMILIES: readonly { pattern: RegExp; group: string }[] = [
  { pattern: /\bh(?:o|ö|oe)rmann\b/i, group: "Hörmann" },
  { pattern: /\bw(?:u|ü|ue)rth\b/i, group: "Würth" },
  { pattern: /\bliebherr\b/i, group: "Liebherr" },
  { pattern: /\bk(?:a|ä|ae)rcher\b/i, group: "Kärcher" },
  { pattern: /\bmulliez\b/i, group: "Mulliez" },
];

/** Forme juridique ou mot qui fait d'un dirigeant une société. */
const COMPANY_NAME = /\b(SA|SAS|SASU|SARL|EURL|SCA|SCS|SNC|SE|GMBH|AG|BV|NV|LTD|LLC|INC|HOLDING|GROUPE|GROUP|COMPAGNIE|SOCIETE|SOCIÉTÉ)\b/i;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Nom du groupe (ou de la société mère) si l'entreprise en est une filiale, `null` sinon. */
/** Mot distinctif d'un nom (≥ 4 lettres, hors forme juridique), pour reconnaître une holding du même nom. */
const coreWords = (name: string) =>
  name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(COMPANY_NAME, " ")
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length >= 4 && !["COMPAGNIE", "HOLDING", "GROUPE", "GROUP", "SOCIETE", "FRANCE"].includes(word));

/**
 * Nom du groupe (ou de la société mère) si l'entreprise en est une filiale, `null` sinon.
 *
 * `companyName` : une société dirigeante qui PORTE LE NOM de l'entreprise
 * (« ALERYS & COMPAGNIE » pour ALERYS) est sa holding familiale, pas un groupe.
 */
export function subsidiaryOf(figures: Record<string, unknown> | null | undefined, companyName?: string | null): string | null {
  const facts = figures ?? {};
  const parent = text(facts.parent_group) || text(facts.parent_company);

  if (facts.parent_foreign === true) return parent || "groupe étranger";
  if (facts.is_large_group_subsidiary === true) return parent || "grand groupe";

  const people = [facts.leader, facts.leader_person, facts.parent_company, facts.parent_group].map(text).filter(Boolean);
  for (const family of KNOWN_GROUP_FAMILIES) {
    if (people.some((name) => family.pattern.test(name.normalize("NFC")))) return family.group;
  }

  const leader = text(facts.leader);
  if (leader && !text(facts.leader_person) && COMPANY_NAME.test(leader)) {
    const own = companyName ? coreWords(companyName) : [];
    if (own.length && coreWords(leader).some((word) => own.includes(word))) return null;
    return parent || leader;
  }
  return null;
}

/** Score affiché et trié : plafonné à 3 pour une filiale. */
export function cappedScore(score: number | null | undefined, subsidiary: string | null): number | null {
  if (score == null) return null;
  return subsidiary ? Math.min(score, SUBSIDIARY_SCORE_CAP) : score;
}

export const subsidiaryBadge = (group: string) => `filiale de groupe (${group})`;
