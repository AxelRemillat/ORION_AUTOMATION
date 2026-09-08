/**
 * Qualification des signaux.
 *
 * Un résultat web brut n'aide pas à vendre. On le traduit ici en une phrase
 * ACTIONNABLE pour une offre d'automatisation / IA ("recrute des postes ops",
 * "volume de support client"), qui servira d'accroche à l'email de prospection.
 * Purement déterministe : pas d'appel LLM sur le chemin de la recherche.
 */
import type { ProspectSignal } from "@/types";
import { effectifFloor } from "./naf";
import type { CompanyBase } from "./types";
import type { WebResult } from "./linkup";

interface Rule {
  type: string;
  pattern: RegExp;
  /** Formulé côté opportunité, pas côté fait brut. */
  label: string;
}

/** Ordre = priorité : un résultat n'est classé que par sa première règle. */
const RULES: Rule[] = [
  {
    type: "levee",
    pattern: /lev[ée]e? de fonds|l[èe]ve \d|s[ée]rie [ABC]\b|tour de table|fundraising|millions d'euros/i,
    label: "Levée de fonds récente — budget disponible pour outiller",
  },
  {
    type: "support",
    pattern: /service client|relation client|SAV\b|hotline|centre d'appel|r[ée]clamation|support client|standard t[ée]l[ée]phonique/i,
    label: "Volume de support client visible — tri et réponses automatisables",
  },
  {
    type: "recrutement",
    pattern: /recrute|recrutement|offres? d'emploi|nous recherchons|rejoignez|CDI\b|assistant[e]?\b|gestionnaire|charg[ée] de (clientèle|gestion|administration)|back[- ]office|op[ée]rations/i,
    label: "Recrute des postes ops/admin — tâches répétitives à outiller",
  },
  {
    type: "ecommerce",
    pattern: /boutique en ligne|e-?commerce|shopify|prestashop|woocommerce|panier|passer commande|livraison sous/i,
    label: "Boutique en ligne active — commandes et SAV automatisables",
  },
  {
    type: "croissance",
    pattern: /croissance|nouvelle agence|ouverture d'un|s'implante|expansion|nouveau site de production|doubl[ée] son|acquisition/i,
    label: "Croissance annoncée — les process internes vont saturer",
  },
  {
    type: "digital",
    pattern: /refonte|nouveau site|digitalisation|transformation num[ée]rique|ERP\b|CRM\b|logiciel m[ée]tier|dématérialisation|intelligence artificielle|automatisation/i,
    label: "Chantier digital en cours — porte d'entrée pour l'automatisation",
  },
  {
    type: "presse",
    pattern: /.+/,
    label: "Actualité récente à utiliser comme accroche",
  },
];

const MAX_PER_TYPE = 2;
const MAX_SIGNALS = 6;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

/** Classe les résultats web en signaux, au plus 2 par type et 6 au total. */
export function qualifyWebResults(results: WebResult[]): ProspectSignal[] {
  const counts = new Map<string, number>();
  const signals: ProspectSignal[] = [];

  for (const result of results) {
    if (signals.length >= MAX_SIGNALS) break;
    const haystack = `${result.title} ${result.snippet}`;
    const rule = RULES.find((candidate) => candidate.pattern.test(haystack));
    if (!rule) continue;

    const count = counts.get(rule.type) ?? 0;
    // "presse" est un fourre-tout : on n'en garde qu'un seul.
    if (count >= (rule.type === "presse" ? 1 : MAX_PER_TYPE)) continue;
    counts.set(rule.type, count + 1);

    signals.push({
      type: rule.type,
      label: rule.label,
      url: result.url,
      source: result.title || hostOf(result.url),
      excerpt: result.snippet.slice(0, 220),
    });
  }

  return signals;
}

/**
 * Signaux déduits des seules données structurelles. Ils garantissent qu'une
 * carte n'est jamais vide, même sans clé Linkup.
 */
export function structuralSignals(company: CompanyBase, headcount?: number | null): ProspectSignal[] {
  const signals: ProspectSignal[] = [];
  const size = headcount ?? effectifFloor(company.figures.effectif_code);

  if (size != null && size >= 20) {
    signals.push({
      type: "structure",
      label: `Effectif d'au moins ${size} personnes — back-office et reporting à fort volume`,
      source: "Données INSEE",
    });
  }
  if (company.naf_section === "G" && company.website) {
    signals.push({
      type: "structure",
      label: "Commerce avec présence web — flux commandes et SAV répétitifs",
      source: "Code NAF",
    });
  }
  if (["I", "Q", "H", "N"].includes(company.naf_section ?? "")) {
    signals.push({
      type: "structure",
      label: "Secteur à forte charge de planification et de prise de rendez-vous",
      source: "Code NAF",
    });
  }
  const year = company.founded_year;
  if (year && new Date().getFullYear() - year <= 6) {
    signals.push({
      type: "structure",
      label: `Entreprise jeune (créée en ${year}) — outillage interne encore artisanal`,
      source: "Données INSEE",
    });
  }

  return signals.slice(0, 3);
}
