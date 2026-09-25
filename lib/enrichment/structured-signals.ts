import type { ProspectSignal } from "@/types";
import { frenchDate } from "./dates";
import type { CompanyEvent, Extraction, JobPosting } from "./extract";

/**
 * Traduction de l'extraction structurée vers le format `ProspectSignal` déjà
 * consommé par le scoring, la fiche prospect et la génération d'emails.
 *
 * On ne change pas le contrat de signal : on le REMPLIT mieux. Un signal issu
 * d'ici porte une citation vérifiée, une date calculée (ou un `null` assumé)
 * et, pour un recrutement, la nature du poste — ce qui permet au scoring de
 * distinguer un automaticien d'un commercial.
 */

/** Type de signal (référentiel de scoring) pour chaque type d'événement. */
const EVENT_TO_SIGNAL: Record<CompanyEvent["type"], string> = {
  "levée": "levee",
  ouverture_site: "croissance",
  acquisition: "croissance",
  nouveau_client: "croissance",
  nouvelle_offre: "digital",
  autre: "presse",
};

const EVENT_LABELS: Record<CompanyEvent["type"], string> = {
  "levée": "Levée de fonds",
  ouverture_site: "Ouverture d'un site",
  acquisition: "Acquisition",
  nouveau_client: "Nouveau client",
  nouvelle_offre: "Nouvelle offre",
  autre: "Actualité",
};

/**
 * Confiance d'un élément extrait.
 *
 * Le plancher est haut (0,85) et c'est justifié : l'élément a passé l'ancrage
 * ET la vérification de citation, deux contrôles que la qualification par
 * expressions régulières ne fait pas. La date ajoute le reste — non pas parce
 * qu'elle rend la preuve plus vraie, mais parce qu'elle la rend datable.
 */
const confidenceOf = (dated: boolean): number => (dated ? 0.95 : 0.85);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function jobSignal(posting: JobPosting): ProspectSignal {
  const host = hostOf(posting.url);
  // « en ligne » remplace la date manquante par ce qu'on sait vraiment : la
  // page repond encore aujourd'hui sur le domaine de l'entreprise.
  const when = posting.postedAt
    ? frenchDate(posting.postedAt)
    : posting.freshness === "en ligne"
      ? "en ligne, non datée"
      : frenchDate(null);

  return {
    type: "recrutement",
    label: `Poste ouvert : ${posting.title} — ${host}, ${when}`,
    url: posting.url,
    source: host,
    ...(posting.postedAt ? { date: posting.postedAt } : {}),
    ...(posting.dateBasis ? { dateBasis: posting.dateBasis } : {}),
    ...(posting.freshness ? { freshness: posting.freshness } : {}),
    ...(posting.freshness === "en ligne" ? { liveOnOfficialSite: true } : {}),
    quote: posting.evidenceQuote,
    confidence: confidenceOf(Boolean(posting.postedAt)),
    category: posting.category,
    structured: true,
  };
}

function eventSignal(event: CompanyEvent): ProspectSignal {
  const host = hostOf(event.url);
  return {
    type: EVENT_TO_SIGNAL[event.type],
    label: `${EVENT_LABELS[event.type]} — ${host}, ${frenchDate(event.date)}`,
    url: event.url,
    source: host,
    ...(event.date ? { date: event.date } : {}),
    ...(event.dateBasis ? { dateBasis: event.dateBasis } : {}),
    quote: event.evidenceQuote,
    confidence: confidenceOf(Boolean(event.date)),
    structured: true,
  };
}

/** Signaux issus de l'extraction, les mieux datés d'abord. */
export function extractionToSignals(extraction: Extraction): ProspectSignal[] {
  const signals = [
    // Une offre dont `validThrough` est depasse ne dit plus rien du present.
    ...extraction.jobPostings.filter((posting) => posting.freshness !== "périmée").map(jobSignal),
    ...extraction.events.map(eventSignal),
  ];
  // Un signal daté passe devant : c'est le seul qui pourra porter une accroche.
  return signals.sort((a, b) => Number(Boolean(b.date)) - Number(Boolean(a.date)));
}

/**
 * Fusionne les signaux structurés avec ceux de la qualification par motifs.
 *
 * Les structurés gagnent sur une même URL : ils disent la même chose en mieux.
 * Les autres sont conservés — le scan par expressions régulières reste le seul
 * filet quand l'extraction n'a rien pu prouver.
 */
export function mergeSignals(
  structured: ProspectSignal[],
  fallback: ProspectSignal[],
  maxSignals = 8,
): ProspectSignal[] {
  const seen = new Set(structured.map((signal) => signal.url).filter(Boolean) as string[]);
  const extra = fallback.filter((signal) => !signal.url || !seen.has(signal.url));
  return [...structured, ...extra].slice(0, maxSignals);
}
