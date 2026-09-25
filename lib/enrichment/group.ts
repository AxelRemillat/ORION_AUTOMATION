import { fetchHoldingProfile, type PappersRepresentative } from "./pappers";
import type { ParentGroup } from "./extract";
import { LARGE_GROUP_HEADCOUNT, LARGE_GROUP_REVENUE_EUR } from "./entity-match";
import { looksLikeSubsidiaryByFigures } from "./headcount";

/**
 * Appartenance à un groupe, et dirigeant réel derrière une holding.
 *
 * Deux problèmes distincts, résolus ensemble parce qu'ils ont la même cause :
 * quand le représentant légal est une société (SC DINOPACHOU, SOCIETE
 * IMMOSTEF), la fiche s'arrête là. On ne sait ni qui écrire, ni si l'entreprise
 * est autonome.
 *
 * On garde DEUX indices indépendants d'appartenance à un groupe, et on les
 * affiche tous les deux :
 *   - REGISTRE : un représentant personne morale, dont on va chercher la
 *     taille (un crédit Pappers, mis en cache 30 jours) ;
 *   - WEB : `parentGroup` remonté par l'extraction structurée, avec sa citation.
 *
 * Ils se confirment souvent, se contredisent parfois. Dans ce cas l'écran
 * montre les deux plutôt qu'un arbitrage silencieux.
 */

/**
 * Mandats de contrôle : un commissaire aux comptes n'est ni le dirigeant ni la
 * maison mère. Sans ce filtre, le cabinet d'audit devient « société mère ».
 */
const NON_OWNER_ROLE =
  /commissaire aux comptes|suppl[eé]ant|liquidateur|administrateur judiciaire|mandataire|expert-comptable/i;

const isOwner = (item: PappersRepresentative): boolean =>
  !item.role || !NON_OWNER_ROLE.test(item.role);

export { LARGE_GROUP_HEADCOUNT, LARGE_GROUP_REVENUE_EUR } from "./entity-match";

export { SUBSIDIARY_HEADCOUNT_HINT, SUBSIDIARY_REVENUE_HINT_EUR, looksLikeSubsidiaryByFigures } from "./headcount";

export interface GroupAssessment {
  /** Société mère issue du registre (représentant personne morale). */
  parentCompany: string | null;
  /** Groupe annoncé par le web, avec sa preuve. */
  parentGroup: string | null;
  parentGroupQuote: string | null;
  parentGroupUrl: string | null;
  /** Vrai dès qu'un indice sérieux rattache l'entreprise à un grand groupe. */
  isLargeGroupSubsidiary: boolean;
  /** Ce qui fonde le drapeau, en clair, source par source. */
  evidence: string[];
  /** Dirigeant personne physique, y compris retrouvé derrière la holding. */
  leaderPerson: string | null;
  leaderRole: string | null;
  /** Holding par laquelle on a dû passer, pour l'affichage « (via …) ». */
  leaderVia: string | null;
  /** Crédits Pappers supplémentaires réellement dépensés ici. */
  extraPappersCalls: number;
}

const EMPTY: GroupAssessment = {
  parentCompany: null,
  parentGroup: null,
  parentGroupQuote: null,
  parentGroupUrl: null,
  isLargeGroupSubsidiary: false,
  evidence: [],
  leaderPerson: null,
  leaderRole: null,
  leaderVia: null,
  extraPappersCalls: 0,
};

const eur = (value: number): string =>
  new Intl.NumberFormat("fr-FR", { notation: "compact", style: "currency", currency: "EUR" }).format(value);

export interface GroupInput {
  /** Représentants légaux publics, tels que Pappers les donne. */
  representatives: PappersRepresentative[];
  /** Dirigeant personne physique déjà connu de l'annuaire public. */
  knownLeaderPerson?: string | null;
  /** Résultat de l'extraction web, s'il y en a un. */
  parentGroup?: ParentGroup | null;
  /**
   * Autorise l'appel Pappers supplémentaire sur la holding. Faux pendant le
   * scan : ces crédits sont réservés à la phase 2 (analyse).
   */
  allowHoldingLookup?: boolean;
  /** Chiffres de l'entreprise : un ratio CA/effectif aberrant trahit une filiale. */
  revenueEur?: number | null;
  headcount?: number | null;
}

export async function assessGroup(input: GroupInput): Promise<GroupAssessment> {
  const result: GroupAssessment = { ...EMPTY, evidence: [] };

  const owners = input.representatives.filter(isOwner);
  const physical = owners.find((item) => !item.isCompany);
  const moral = owners.find((item) => item.isCompany);

  result.leaderPerson = physical?.name ?? input.knownLeaderPerson ?? null;
  result.leaderRole = physical?.role ?? null;
  result.parentCompany = moral?.name ?? null;

  // --- Indice WEB ---------------------------------------------------------
  if (input.parentGroup) {
    result.parentGroup = input.parentGroup.name;
    result.parentGroupQuote = input.parentGroup.evidenceQuote;
    result.parentGroupUrl = input.parentGroup.url;
    result.isLargeGroupSubsidiary = true;
    result.evidence.push(`Web : « ${input.parentGroup.evidenceQuote} » (${input.parentGroup.url})`);
  }

  // --- Indice CHIFFRES ----------------------------------------------------
  // Il vaut meme sans representant personne morale : c'est le cas d'EG RETAIL.
  if (looksLikeSubsidiaryByFigures(input.revenueEur, input.headcount)) {
    result.isLargeGroupSubsidiary = true;
    result.evidence.push(
      `Chiffres : ${eur(input.revenueEur as number)} de CA pour ${input.headcount} salariés — ` +
        "volume incompatible avec une structure autonome",
    );
  }

  if (!moral) return result;

  // --- Indice REGISTRE ----------------------------------------------------
  result.evidence.push(`Registre : représentée par ${moral.name}, personne morale`);

  if (!moral.siren || input.allowHoldingLookup === false) return result;

  const holding = await fetchHoldingProfile(moral.siren);
  if (!holding) return result;
  result.extraPappersCalls = 1;

  // Le dirigeant réel : la première personne physique de la holding.
  const person = holding.people[0];
  if (person && !result.leaderPerson) {
    result.leaderPerson = person.name;
    result.leaderRole = person.role;
    result.leaderVia = moral.name;
  } else if (person && result.leaderPerson && result.leaderPerson === moral.name) {
    // Le « dirigeant » connu était en fait la holding : on le remplace.
    result.leaderPerson = person.name;
    result.leaderRole = person.role;
    result.leaderVia = moral.name;
  }

  const big: string[] = [];
  if (holding.revenue_eur != null && holding.revenue_eur > LARGE_GROUP_REVENUE_EUR) {
    big.push(`CA ${eur(holding.revenue_eur)}`);
  }
  if (holding.headcount != null && holding.headcount > LARGE_GROUP_HEADCOUNT) {
    big.push(`${holding.headcount} salariés`);
  }
  if (big.length) {
    result.isLargeGroupSubsidiary = true;
    result.evidence.push(`Registre : ${moral.name} pèse ${big.join(", ")}`);
  }

  return result;
}

/** Salutation prête à l'emploi : « Prénom Nom (via HOLDING) », ou rien. */
export function leaderDisplay(assessment: Pick<GroupAssessment, "leaderPerson" | "leaderVia">): string | null {
  if (!assessment.leaderPerson) return null;
  return assessment.leaderVia
    ? `${assessment.leaderPerson} (via ${assessment.leaderVia})`
    : assessment.leaderPerson;
}
