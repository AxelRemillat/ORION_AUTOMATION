import { effectifFloor } from "@/lib/enrichment/naf";
import type { Segment, SegmentInput, SegmentPattern, SegmentVerdict } from "./types";

/**
 * SEGMENT « AGENCES » — sous-traitance en marque blanche.
 *
 * Axel réalise, l'agence vend : automatisations n8n/IA, agents, intégrations
 * d'API, petits outils full stack. La cible n'est donc pas une PME qui a un
 * besoin, mais un intermédiaire qui a des clients et pas la main-d'œuvre.
 *
 * CODES NAF — vérifiés un à un contre la nomenclature NAF rév. 2 :
 *   73.11Z  Activités des agences de publicité      — le cœur de cible
 *   62.01Z  Programmation informatique              — très large, cf. ci-dessous
 *   74.10Z  Activités spécialisées de design        — studios web et graphiques
 *   70.21Z  Conseil en relations publiques et comm. — agences de com
 *   62.02A  Conseil en systèmes et logiciels info.  — AJOUTÉ (cf. rapport)
 *
 * 62.01Z et 62.02A contiennent autant de développeurs indépendants et
 * d'éditeurs de logiciels que d'agences : seul le site tranche. C'est pour cela
 * que le NAF ne qualifie jamais à lui seul — il délimite un vivier.
 *
 * Écartés volontairement : 73.12Z (régie publicitaire : achat d'espace, aucune
 * production), 63.11Z (hébergement et traitement de données), 82.99Z (fourre-tout
 * de services administratifs).
 */

export const AGENCES_NAF: Readonly<Record<string, string>> = {
  "73.11Z": "Activités des agences de publicité",
  "62.01Z": "Programmation informatique",
  "74.10Z": "Activités spécialisées de design",
  "70.21Z": "Conseil en relations publiques et communication",
  "62.02A": "Conseil en systèmes et logiciels informatiques",
};

/**
 * Tranches INSEE retenues pour « 3 à 50 salariés » :
 *   02 → 3 à 5 · 03 → 6 à 9 · 11 → 10 à 19 · 12 → 20 à 49.
 *
 * `01` (1 à 2) est exclu : à deux, personne n'a de budget de sous-traitance.
 * `21` (50 à 99) aussi : la tranche déborde largement la borne haute, et une
 * agence de 80 personnes a ses propres équipes techniques.
 */
export const AGENCES_EFFECTIF_CODES = ["02", "03", "11", "12"] as const;

export const AGENCES_HEADCOUNT = { min: 3, max: 50 } as const;

/** Plafond quotidien du segment, pris DANS le plafond commun d'envoi. */
export const AGENCES_DAILY_CAP = 5;

/**
 * CE QUI QUALIFIE — l'agence dit elle-même qu'elle vend du web ou du marketing.
 * Un seul de ces motifs suffit : ils sont tous des affirmations d'activité, pas
 * des mots de décor.
 */
export const AGENCY_SIGNALS: readonly SegmentPattern[] = [
  { label: "agence web", pattern: /\bagence\s+(?:web|digitale?|num[ée]rique|interactive)\b/i },
  { label: "création de site", pattern: /\b(?:cr[ée]ation|conception|refonte)\s+(?:de\s+)?sites?\b/i },
  { label: "marketing digital", pattern: /\bmarketing\s+(?:digital|num[ée]rique|en\s+ligne)\b/i },
  { label: "SEO/SEA", pattern: /\b(?:seo|sea|sem|r[ée]f[ée]rencement\s+(?:naturel|payant)|google\s+ads|adwords)\b/i },
  { label: "e-commerce", pattern: /\b(?:e-?commerce|boutique\s+en\s+ligne|shopify|prestashop|woocommerce|magento)\b/i },
  { label: "agence de communication", pattern: /\bagence\s+(?:de\s+)?(?:communication|publicit[ée]|marketing)\b/i },
];

/**
 * CE QUI DISQUALIFIE — l'agence vend DÉJÀ ce qu'Axel propose.
 *
 * Deux familles de preuves, et les deux sont des affirmations d'offre :
 *   - un OUTIL nommé (n8n, Make, Zapier, Power Automate) : on ne cite pas son
 *     orchestrateur par hasard, on le cite parce qu'on le vend ;
 *   - une OFFRE formulée (« nous automatisons », « agents IA sur mesure »).
 *
 * Volontairement exclu : la simple mention de « intelligence artificielle » ou
 * de « ChatGPT ». Toutes les agences en parlent sur leur blog depuis 2023 ;
 * en faire un critère de concurrence viderait le segment.
 */
export const COMPETITOR_SIGNALS: readonly SegmentPattern[] = [
  { label: "outil d'automatisation nommé", pattern: /\b(?:n8n|make\.com|zapier|power\s+automate|activepieces|windmill)\b/i },
  { label: "offre d'automatisation", pattern: /\b(?:nous\s+automatisons|automatisation\s+(?:de\s+)?(?:vos|votre|des)\s+(?:process|processus|t[âa]ches|flux))\b/i },
  { label: "offre d'agents IA", pattern: /\bagents?\s+(?:ia|conversationnels?|intelligents?)\b/i },
  { label: "offre d'intégration IA", pattern: /\b(?:int[ée]gration|d[ée]ploiement)\s+(?:d['’]\s*)?(?:ia|intelligence\s+artificielle)\b/i },
];

/** Premier motif trouvé dans le texte, ou `null`. */
function firstMatch(patterns: readonly SegmentPattern[], text: string): string | null {
  return patterns.find((item) => item.pattern.test(text))?.label ?? null;
}

/** Tous les motifs trouvés, dans l'ordre de déclaration. */
function allMatches(patterns: readonly SegmentPattern[], text: string): string[] {
  return patterns.filter((item) => item.pattern.test(text)).map((item) => item.label);
}

/** Code NAF normalisé : « 7311Z », « 73.11z » et « 73.11Z » désignent la même chose. */
export function normalizeNaf(naf: string | null | undefined): string | null {
  const raw = (naf ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (raw.length < 4) return null;
  return `${raw.slice(0, 2)}.${raw.slice(2)}`;
}

/** La taille est-elle dans la cible ? L'effectif réel l'emporte sur la tranche. */
export function sizeFits(input: Pick<SegmentInput, "headcount" | "effectifCode">): {
  ok: boolean;
  reason: string | null;
} {
  if (typeof input.headcount === "number" && Number.isFinite(input.headcount)) {
    const { min, max } = AGENCES_HEADCOUNT;
    return input.headcount >= min && input.headcount <= max
      ? { ok: true, reason: null }
      : { ok: false, reason: `effectif ${input.headcount} hors cible (${min} à ${max})` };
  }

  const code = input.effectifCode ?? null;
  if (!code || code === "NN") {
    // Tranche non déterminée : on ne rejette pas sur une donnée absente.
    return { ok: true, reason: null };
  }
  if ((AGENCES_EFFECTIF_CODES as readonly string[]).includes(code)) return { ok: true, reason: null };

  const floor = effectifFloor(code);
  return {
    ok: false,
    reason: floor === null ? `tranche d'effectif « ${code} » hors cible` : `tranche à partir de ${floor} salariés, hors cible (3 à 50)`,
  };
}

/**
 * Juge l'appartenance au segment.
 *
 * L'ordre compte : on écarte d'abord sur ce qui est gratuit et certain (NAF,
 * taille), et on ne lit le site qu'ensuite. Un concurrent est signalé même
 * quand il est par ailleurs dans la cible : c'est l'information la plus utile
 * à remonter.
 */
export function classifyAgence(input: SegmentInput): SegmentVerdict {
  const base = { segment: "agences" as const, signals: [] as string[], competitor: null as string | null };

  const naf = normalizeNaf(input.naf);
  if (!naf || !(naf in AGENCES_NAF)) {
    return { ...base, fit: "dehors", reason: naf ? `NAF ${naf} hors liste du segment` : "code NAF inconnu" };
  }

  const size = sizeFits(input);
  if (!size.ok) return { ...base, fit: "dehors", reason: size.reason };

  const text = (input.siteText ?? "").trim();
  if (!text) {
    return {
      ...base,
      fit: "indécidable",
      reason: "site non lu : impossible de confirmer qu'il s'agit d'une agence",
    };
  }

  // Le concurrent est détecté AVANT la qualification : une agence qui vend
  // déjà n8n est un partenaire possible, pas une cible, même si elle coche
  // tous les autres critères.
  const competitor = firstMatch(COMPETITOR_SIGNALS, text);
  const signals = allMatches(AGENCY_SIGNALS, text);

  if (competitor) {
    return {
      ...base,
      signals,
      competitor,
      fit: "dehors",
      reason: `concurrent / partenaire possible : ${competitor} sur le site`,
    };
  }

  if (!signals.length) {
    return {
      ...base,
      fit: "dehors",
      reason: `NAF ${naf} dans le vivier, mais le site ne revendique ni web ni marketing`,
    };
  }

  return { ...base, signals, fit: "dedans", reason: null };
}

export const AGENCES_SEGMENT: Segment = {
  key: "agences",
  label: "Agences web & marketing",
  pitch:
    "Agences web et marketing de 3 à 50 personnes : elles vendent à leurs clients, Axel réalise en marque blanche.",
  naf: AGENCES_NAF,
  effectifCodes: AGENCES_EFFECTIF_CODES,
  headcount: AGENCES_HEADCOUNT,
  dailyCap: AGENCES_DAILY_CAP,
  family: "F5",
  classify: classifyAgence,
};
