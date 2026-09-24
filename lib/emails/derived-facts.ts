import type { Prospect } from "@/types";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import { resolvePlaybook } from "@/lib/sector-playbook";

/**
 * Faits du prospect, calculés côté serveur.
 *
 * Le LLM ne recevait que des valeurs brutes — « CA 40 878 286 € », « créée en
 * 1969 » — et n'en tirait rien d'autre qu'une paraphrase (« longue expérience
 * depuis 1969 »). Les déductions arithmétiques appartiennent au code : il les
 * fait juste, à coût nul, et le modèle n'a plus qu'à les interpréter.
 *
 * Chaque fait porte un `id` stable (f1, f2…) que l'analyse doit citer. C'est ce
 * qui rend une affirmation vérifiable : pas de factId, pas d'affirmation.
 */

export type FactSource =
  | "Annuaire Entreprises"
  | "Pappers"
  | "Site officiel"
  | "Hunter"
  | "Signal web"
  | "calculé";

export interface DerivedFact {
  id: string;
  label: string;
  value: string;
  /**
   * D'où vient VRAIMENT la donnée. Une date de création ou un chiffre
   * d'affaires ne viennent jamais du site officiel : ils viennent du
   * répertoire légal.
   */
  source: FactSource;
  url?: string;
}

const ANNUAIRE = "https://annuaire-entreprises.data.gouv.fr/entreprise/";

/**
 * Milieu d'une tranche d'effectif INSEE.
 *
 * Les libellés sont du texte libre (« 20 à 49 salariés », « 100 à 199 »,
 * « 10 000 salariés et plus »). On prend le milieu des deux bornes, ou la
 * borne seule quand la tranche est ouverte.
 */
export function headcountMidpoint(sizeRange: string | null | undefined): number | null {
  if (!sizeRange) return null;
  const numbers = sizeRange.replace(/ /g, "").match(/\d[\d\s]*/g);
  if (!numbers?.length) return null;

  const bounds = numbers.map((value) => Number(value.replace(/\s/g, ""))).filter(Number.isFinite);
  if (!bounds.length) return null;
  if (bounds.length === 1) {
    // « 10 000 salariés et plus » : on ne peut que retenir la borne basse.
    return bounds[0];
  }
  return Math.round((bounds[0] + bounds[1]) / 2);
}

/**
 * Lecture qualitative du CA par salarié.
 *
 * Les seuils sont grossiers et assumés : le but n'est pas de classer une
 * entreprise, c'est de dire au modèle ce que ce ratio SIGNIFIE, pour qu'il
 * en tire une implication au lieu de recracher le nombre.
 */
export function revenuePerHeadReading(perHead: number): string {
  if (perHead >= 800_000) {
    return "CA/salarié très élevé : forte volumétrie de flux, activité de négoce, de portage ou de revente d'énergie plutôt que de la production interne";
  }
  if (perHead >= 300_000) {
    return "CA/salarié élevé : beaucoup de volume traité par peu de personnes, donc des flux administratifs denses";
  }
  if (perHead >= 120_000) {
    return "CA/salarié dans la moyenne haute des services : activité à forte intensité de main-d'œuvre encadrée";
  }
  return "CA/salarié modéré : activité à forte intensité de main-d'œuvre";
}

const euros = (value: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export interface FactsResult {
  facts: DerivedFact[];
  /** Effectif retenu pour les ratios, et d'où il vient. */
  headcount: number | null;
}

/**
 * Construit la liste des faits, numérotés dans l'ordre.
 *
 * L'ordre n'est pas neutre : identité, métier, taille, argent, puis les
 * déductions. Le modèle lit de haut en bas.
 */
export function buildFacts(
  prospect: Prospect,
  contact?: DecisionMakerContact | null,
  now = new Date(),
): FactsResult {
  const figures = prospect.key_figures ?? {};
  const facts: DerivedFact[] = [];
  let counter = 0;
  const add = (label: string, value: string | null, source: FactSource, url?: string) => {
    if (!value) return;
    counter += 1;
    facts.push({ id: `f${counter}`, label, value, source, ...(url ? { url } : {}) });
  };

  const siren = str(prospect.siren);
  const annuaireUrl = siren ? `${ANNUAIRE}${siren}` : undefined;

  // --- Identité et métier --------------------------------------------------
  const nafCode = str(figures.naf_code);
  const playbook = resolvePlaybook(nafCode, prospect.sector);
  add(
    "Activité (NAF)",
    nafCode && prospect.sector ? `${nafCode} — ${prospect.sector}` : (prospect.sector ?? nafCode),
    "Annuaire Entreprises",
    annuaireUrl,
  );
  if (playbook.processes.length) {
    add("Famille métier", playbook.family, "calculé");
  }
  add("Ville", str(prospect.city), "Annuaire Entreprises", annuaireUrl);
  add("Site officiel", str(prospect.website), "Site officiel", str(prospect.website) ?? undefined);

  // --- Taille --------------------------------------------------------------
  const sizeRange = str(prospect.size_range) ?? str(figures.size_range);
  add("Tranche d'effectif", sizeRange, "Annuaire Entreprises", annuaireUrl);

  const exact = num(figures.headcount);
  if (exact !== null) add("Effectif", `${exact} salariés`, "Pappers");
  const headcount = exact ?? headcountMidpoint(sizeRange);

  // --- Argent --------------------------------------------------------------
  const revenue = num(figures.revenue_eur);
  const revenueYear = num(figures.revenue_year);
  add(
    "Chiffre d'affaires",
    revenue !== null ? `${euros(revenue)}${revenueYear ? ` (exercice ${revenueYear})` : ""}` : null,
    "Pappers",
  );
  add("Résultat net", num(figures.net_income_eur) !== null ? euros(figures.net_income_eur as number) : null, "Pappers");
  add("Capital social", num(figures.capital_eur) !== null ? euros(figures.capital_eur as number) : null, "Pappers");

  // --- Déductions arithmétiques -------------------------------------------
  if (revenue !== null && headcount) {
    const perHead = Math.round(revenue / headcount);
    add(
      "CA par salarié",
      `${euros(perHead)} par personne (${euros(revenue)} ÷ ${headcount}) — ${revenuePerHeadReading(perHead)}`,
      "calculé",
    );
  }

  const founded = num(figures.founded_year);
  if (founded !== null) {
    const age = now.getFullYear() - founded;
    add("Ancienneté", `${age} ans (créée en ${founded})`, "Annuaire Entreprises", annuaireUrl);
  }

  add("Forme juridique", str(figures.legal_form), "Annuaire Entreprises", annuaireUrl);
  add(
    "Dirigeant",
    str(figures.leader)
      ? `${str(figures.leader)}${str(figures.leader_role) ? ` (${str(figures.leader_role)})` : ""}`
      : null,
    "Pappers",
  );

  // --- Contact nominatif ---------------------------------------------------
  if (contact?.email) {
    const parts = [contact.full_name, contact.position].filter(Boolean).join(", ");
    add(
      "Contact identifié",
      `${parts || contact.email}${contact.confidence != null ? ` — confiance ${contact.confidence} %` : ""}`,
      "Hunter",
    );
  }

  // --- Signaux attestés ----------------------------------------------------
  for (const signal of prospect.signals ?? []) {
    const quote = str(signal.quote);
    if (!quote || !str(signal.url)) continue;
    add(
      "Signal web",
      `${quote}${str(signal.date) ? ` (${str(signal.date)})` : ""}`,
      "Signal web",
      str(signal.url) ?? undefined,
    );
  }

  return { facts, headcount };
}

/** Bloc numéroté injecté dans le prompt d'analyse. */
export function factsBlock(facts: DerivedFact[]): string {
  if (!facts.length) return "FAITS : aucun. Dis-le plutot que d'inventer.";
  return `FAITS NUMEROTES — tu ne peux affirmer que ce qui s'appuie sur ces ids.
${facts
  .map((fact) => `[${fact.id}] ${fact.label} : ${fact.value}  (source : ${fact.source}${fact.url ? `, ${fact.url}` : ""})`)
  .join("\n")}`;
}

/**
 * Nombres presents dans les faits, sous toutes leurs formes utiles.
 *
 * Sert au validateur : un nombre du mail doit exister ici, brut, arrondi au
 * millier ou au million. Sinon il a ete invente.
 */
export function knownNumbers(facts: DerivedFact[]): Set<number> {
  const known = new Set<number>();
  for (const fact of facts) {
    const matches = fact.value.replace(/ /g, " ").matchAll(/\d[\d\s]*(?:[.,]\d+)?/g);
    for (const match of matches) {
      const value = Number(match[0].replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(value)) continue;
      known.add(value);
      known.add(Math.round(value));
      // « 40 878 286 € » doit autoriser « 41 M€ » et « 40,9 M€ ».
      known.add(Math.round(value / 1_000));
      known.add(Math.round(value / 1_000_000));
      known.add(Math.floor(value / 1_000_000));
    }
  }
  return known;
}
