import type { DerivedFact } from "@/lib/emails/derived-facts";
import type { StrategyBrief } from "@/lib/emails/strategist";

/**
 * PAS DE MAIL SANS MATIÈRE (règle Cowork n° 3, itération 1).
 *
 * Avant toute rédaction, deux conditions :
 *   - un FAIT PROPRE vérifiable, lu sur le site ou dans un article : offre,
 *     gamme, clientèle, sites, services, ouverture d'établissement… Le secteur,
 *     le NAF, l'effectif ou l'offre d'emploi ne suffisent pas : sans eux, le
 *     modèle écrit « Dans le commerce de gros… » (C.T.A., LYPSIS : 5-6/10) ;
 *   - un pain qui n'est pas une HYPOTHÈSE (« si ces tâches font partie du
 *     poste… », LYPSIS).
 * Sinon : aucun mail, la fiche part en « À revoir » avec la raison. Aucun appel
 * payant n'est fait pour un mail qu'on n'enverrait pas.
 */

const OWN_KEYS = new Set([
  "site_offer",
  "business_offer",
  "business_customers",
  "business_channels",
  "business_locations",
  "business_services",
  "opening",
]);

/** Un signal web qui n'est pas une offre d'emploi (article, annonce d'ouverture…). */
const isWebNews = (fact: DerivedFact) =>
  fact.key === "signal" && fact.source === "Signal web" && !/recrut|poste|offre d['’]emploi|france travail|\(h\/f\)/i.test(`${fact.label} ${fact.value}`);

export function ownFacts(facts: readonly DerivedFact[]): DerivedFact[] {
  return facts.filter((fact) => OWN_KEYS.has(fact.key) || isWebNews(fact));
}

/**
 * EXCEPTION ÉTROITE (décision Cowork, itération 2) : une raison sociale ou une
 * enseigne qui nomme AU MOINS DEUX activités précises (« ACTUEL VERANDA ET
 * MENUISERIE ») vaut un fait propre. Deux noms de famille (« BLANCHARD ET
 * BLAZQUEZ ») ou un mot générique (« SERVICE ») n'en sont pas ; le NAF seul,
 * jamais.
 */
const ACTIVITIES: Record<string, string> = {
  veranda: "vérandas", verandas: "vérandas", menuiserie: "menuiserie", menuiseries: "menuiserie", serrurerie: "serrurerie",
  metallerie: "métallerie", plomberie: "plomberie", chauffage: "chauffage", climatisation: "climatisation", electricite: "électricité",
  couverture: "couverture", charpente: "charpente", maconnerie: "maçonnerie", peinture: "peinture", carrelage: "carrelage",
  isolation: "isolation", zinguerie: "zinguerie", depannage: "dépannage", ramonage: "ramonage", fermetures: "fermetures",
  stores: "stores", volets: "volets", portails: "portails", cuisines: "cuisines", cuisine: "cuisines", salles: "salles de bains",
  boulangerie: "boulangerie", patisserie: "pâtisserie", traiteur: "traiteur", chocolaterie: "chocolaterie", transport: "transport",
  transports: "transport", logistique: "logistique", demenagement: "déménagement", terrassement: "terrassement", paysage: "paysage",
  jardins: "jardins", piscines: "piscines", nettoyage: "nettoyage", froid: "froid", ventilation: "ventilation", toiture: "toiture",
  imprimerie: "imprimerie", signaletique: "signalétique", mobilier: "mobilier", agencement: "agencement", ebenisterie: "ébénisterie",
};

export function nameActivities(name: string | null | undefined): string[] {
  const words = (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z]+/);
  return [...new Set(words.map((word) => ACTIVITIES[word]).filter((value): value is string => Boolean(value)))];
}

/** Le fait « activités (raison sociale) », ou `null` s'il en nomme moins de deux. */
export function nameFact(name: string | null | undefined): DerivedFact | null {
  const activities = nameActivities(name);
  if (activities.length < 2) return null;
  return {
    id: "N1",
    key: "business_services",
    label: "Activités (raison sociale)",
    value: activities.join(", "),
    source: "Annuaire Entreprises",
    hookTier: 2,
    bodyUsable: true,
  } as DerivedFact;
}

/**
 * Doute sur LEUR fonctionnement (« si ces tâches font partie du poste », « si
 * les pièces arrivent par mail », « s'ils en utilisent un »). Une condition
 * TECHNIQUE de l'automatisation (« si le seuil est atteint », « si la réponse
 * manque ») n'est pas une hypothèse : itération 2, AKTID, SPI ENERGIE et AGCEI
 * étaient bloqués à tort.
 */
const UNCERTAIN_TASK = /\bsi (ces|vos|cette|leurs?|elles?|ils?)\b|font partie du poste|[ée]ventuellement|peut-[êe]tre|probablement|sans doute|[àa] confirmer|suppos/i;
const UNCERTAIN_IDEA =
  /\bsi (les|vos|leurs?|ces) [^,.;]{0,40}\b(arrivent|arrive|parviennent|sont (re[çc]us?|envoy[ée]s?)|utilisent|existent?)\b|s['’]ils? en (utilise|utilisent|a|ont)|font partie du poste|[ée]ventuellement|peut-[êe]tre|probablement|[àa] confirmer/i;

export type Readiness = { ok: true; own: DerivedFact[] } | { ok: false; reason: string };

export function mailReadiness(input: {
  facts: readonly DerivedFact[];
  brief: Pick<StrategyBrief, "pain">;
  hasSite?: boolean;
  /** Raison sociale ou enseigne : l'exception « deux activités nommées ». */
  companyName?: string | null;
}): Readiness {
  const listed = ownFacts(input.facts);
  const byName = listed.length ? null : nameFact(input.companyName);
  const own = byName ? [byName] : listed;
  if (!own.length) {
    return {
      ok: false,
      reason:
        input.hasSite === false
          ? "À revoir — sans site : aucun site trouvé (recherche gratuite), donc aucun fait propre à citer"
          : "profil insuffisant : aucun fait propre lu sur le site (offre, gamme, clientèle, implantations)",
    };
  }
  const doubt = input.brief.pain.task.match(UNCERTAIN_TASK) ?? input.brief.pain.automationIdea.match(UNCERTAIN_IDEA);
  if (doubt) return { ok: false, reason: `pain incertain : formulé comme une hypothèse (« ${doubt[0]} »)` };
  return { ok: true, own };
}
