/**
 * Ciblage : qui n'est pas un prospect, et pourquoi.
 *
 * Deux exclusions de nature très différente, volontairement séparées :
 *
 *   1. **Structurelle** — une association, une commune ou un syndicat n'achète
 *      pas une prestation de mise en production IA de la même façon qu'une
 *      société commerciale, quand elle l'achète. Ces entités sont écartées par
 *      défaut, et la règle ne se règle pas au cas par cas : elle se désactive
 *      d'un bloc avec « Inclure les exclus ».
 *   2. **Sectorielle** — Axel sait, lui, qu'une auto-école ou un centre de
 *      contrôle technique ne l'intéresse pas. Cette liste lui appartient, elle
 *      vit en base et il la modifie.
 *
 * Le module ne fait AUCUN appel : il décide sur des données déjà payées. C'est
 * ce qui permet de l'appliquer avant l'ouverture d'une fiche, donc avant de
 * dépenser.
 */

import type { CompanyBase } from "@/lib/enrichment/types";

/**
 * Catégories juridiques écartées, par préfixe INSEE.
 *
 * Le référentiel INSEE est hiérarchique : le premier chiffre donne la famille.
 *   7xxx  personne morale et organisme soumis au droit administratif
 *         (État, collectivités, établissements publics)
 *   8xxx  organisme privé spécialisé (dont syndicats professionnels)
 *   92xx  association (9220 association déclarée, 9260 syndicat professionnel)
 *   93xx  fondation
 *
 * Volontairement par préfixe et non par liste exhaustive : l'INSEE ajoute des
 * codes, et une liste fermée aurait laissé passer les nouveaux en silence.
 */
export const EXCLUDED_LEGAL_PREFIXES = ["7", "8", "92", "93"] as const;

/** Entrepreneur individuel : première famille du référentiel. */
const SOLE_TRADER_PREFIX = "1";

/**
 * Tranches d'effectif considérées comme « sans salarié ».
 *
 * `00` est explicite. `NN` veut dire « non renseigné », et pour un entrepreneur
 * individuel cela signifie en pratique qu'aucune masse salariale n'a été
 * déclarée — on l'écarte donc aussi. Pour une société, `NN` reste un doute qui
 * profite à la cible (cf. `tierOf`) : la règle ne s'applique qu'aux EI.
 */
const NO_EMPLOYEE_CODES = new Set(["00", "NN"]);

/** Motif d'exclusion, formulé pour être affiché tel quel. */
export interface Exclusion {
  kind: "structure" | "secteur";
  reason: string;
}

/** Code NAF comparable : « 85.53Z », « 8553Z » et « 8553z » sont le même. */
export function normalizeNaf(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/**
 * L'entreprise tombe-t-elle sous une exclusion sectorielle ?
 *
 * Une entrée de la liste peut être un code complet (`8553Z`), une classe
 * (`8553`), un groupe (`855`) ou une division (`85`) : le préfixe suffit, ce
 * qui permet d'écarter « tout l'enseignement » sans énumérer ses classes.
 */
export function matchesExcludedSector(
  naf: string | null | undefined,
  excluded: readonly string[],
): string | null {
  const code = normalizeNaf(naf);
  if (!code) return null;
  for (const entry of excluded) {
    const prefix = normalizeNaf(entry);
    if (prefix && code.startsWith(prefix)) return entry;
  }
  return null;
}

/**
 * Pourquoi cette entreprise n'est pas une cible, ou `null` si elle en est une.
 *
 * L'ordre compte : la raison structurelle passe avant la sectorielle, parce
 * qu'elle est plus dirimante et plus parlante (« c'est une association » dit
 * plus que « secteur exclu »).
 */
export function exclusionOf(
  company: Pick<CompanyBase, "company_name" | "naf_code" | "legal_form"> & {
    figures?: { legal_code?: string | null; effectif_code?: string | null } | null;
  },
  excludedSectors: readonly string[] = [],
): Exclusion | null {
  const legal = (company.figures?.legal_code ?? "").trim();
  const effectif = (company.figures?.effectif_code ?? "").trim();

  if (legal) {
    for (const prefix of EXCLUDED_LEGAL_PREFIXES) {
      if (legal.startsWith(prefix)) {
        return {
          kind: "structure",
          reason: `${company.company_name} — ${company.legal_form ?? `catégorie juridique ${legal}`}, hors cible commerciale`,
        };
      }
    }
    // Un entrepreneur individuel sans salarié est une personne seule : ni le
    // besoin ni le budget d'une mise en production.
    if (legal.startsWith(SOLE_TRADER_PREFIX) && NO_EMPLOYEE_CODES.has(effectif || "NN")) {
      return {
        kind: "structure",
        reason: `${company.company_name} — entreprise individuelle sans salarié`,
      };
    }
  }

  const sector = matchesExcludedSector(company.naf_code, excludedSectors);
  if (sector) {
    return {
      kind: "secteur",
      reason: `${company.company_name} — secteur exclu (${sector})`,
    };
  }

  return null;
}

/**
 * Secteurs exclus par défaut, posés à la création du réglage.
 *
 * Deux activités de proximité très nombreuses à Lyon comme à Paris, sans aucun
 * flux à automatiser à l'échelle visée. Ce ne sont que des valeurs de départ :
 * la liste vit en base et se modifie.
 *
 *   85.53Z enseignement de la conduite (auto-écoles)
 *   71.20A contrôle technique automobile
 */
export const DEFAULT_EXCLUDED_SECTORS = ["8553Z", "7120A"] as const;
