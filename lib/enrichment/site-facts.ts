/**
 * Signal ou fait « site » ?
 *
 * Constat : une page « À propos », « Qui sommes-nous », « Notre histoire » ou
 * « Recrutement » générique ressortait en « Signal web ». Sur son propre
 * domaine, l'ancrage vaut déjà 0,5 de confiance ; il suffisait qu'une phrase
 * contienne « recrutement » ou « service client » pour qu'une présentation
 * institutionnelle passe pour une actualité — et ouvre un mail.
 *
 * Règle : un SIGNAL est un événement datable — ouverture, nomination, levée,
 * rachat, offre d'emploi précise, nouveau client, nouvelle offre. Tout le reste
 * de ce qu'une entreprise dit d'elle-même est un FAIT « site » : vrai, utile au
 * stratège, mais jamais une accroche d'actualité. Il est conservé à part, dans
 * `key_figures.site_facts`.
 */
import type { ProspectSignal } from "@/types";
import type { WebResult } from "./linkup";

/** Fait tiré du site : ce que l'entreprise dit d'elle, sans valeur d'actualité. */
export interface SiteFact {
  /** Phrase exacte de la source. */
  text: string;
  url: string;
  /** Nature de la page : présentation institutionnelle ou recrutement générique. */
  page: "presentation" | "recrutement" | "autre";
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dernier segment d'URL de présentation : la page EST la présentation. */
const PRESENTATION_SLUG =
  /^(a-?propos|about(-us)?|qui-sommes-nous|notre-histoire|histoire|historique|presentation|l-?entreprise|la-societe|notre-societe|societe|entreprise|nos-valeurs|valeurs|notre-equipe|equipe|team|mission|notre-mission)$/;

/**
 * Dernier segment d'une page carrière GÉNÉRIQUE. Une offre précise a un
 * segment de plus (`/recrutement/automaticien-h-f`) : elle ne matche pas.
 */
const CAREERS_SLUG =
  /^(recrutement|recrute|carrieres?|careers?|nous-rejoindre|rejoignez-nous|rejoindre|jobs?|emplois?|offres?-d-?emplois?|travailler-chez-nous)$/;

/** Titres de page institutionnels, en tête ou après un séparateur. */
const PRESENTATION_TITLE =
  /(^|[|\-–—:·]\s)(a propos|qui sommes-nous|qui sommes nous|notre histoire|notre entreprise|notre societe|presentation|nos valeurs|notre equipe)\b/;
const CAREERS_TITLE =
  /(^|[|\-–—:·]\s)(recrutement|carrieres?|nous rejoindre|rejoignez-nous|travailler chez)\b(?!\s*:\s*\S)/;

/** Nature d'une page d'après son URL et son titre ; `null` = page ordinaire. */
export function genericPageKind(url: string, title = ""): SiteFact["page"] | null {
  let slug = "";
  try {
    const segments = new URL(url).pathname
      .split("/")
      .map((part) => normalize(decodeURIComponent(part)).replace(/\.(html?|php|aspx?)$/, ""))
      .filter(Boolean);
    slug = segments[segments.length - 1] ?? "";
  } catch {
    // URL illisible : seul le titre peut encore trancher.
  }
  if (PRESENTATION_SLUG.test(slug)) return "presentation";
  if (CAREERS_SLUG.test(slug)) return "recrutement";

  const heading = normalize(title);
  if (PRESENTATION_TITLE.test(heading)) return "presentation";
  if (CAREERS_TITLE.test(heading)) return "recrutement";
  return null;
}

/**
 * Événement datable. Les verbes sont au présent, au passé ou au futur : ce qui
 * compte, c'est qu'un fait AIT LIEU à une date, pas qu'elle soit écrite. Les
 * formes ambiguës sont bornées : « ouvert du lundi au vendredi » et « horaires
 * d'ouverture » ne sont pas des ouvertures.
 */
const EVENT_FORMS = [
  "ouvr(e|ira|ons|ent|ir) (un|une|son|sa|ses|notre|nos|leur|leurs|de nouve)",
  "ouverture (d-un|d-une|de (notre|la|son|sa|nos|ses|leur|l-)|du (nouveau|site|magasin))",
  "inaugur\\w*",
  "s-?implant(e|era|ent)",
  "nouvel(le)? (agence|usine|entrepot|boutique|implantation|antenne|directrice|presidente|dirigeante|offre|gamme|solution|marque)",
  "nouveau (site de production|magasin|directeur|president|dirigeant|dg|client|contrat|produit|service|partenariat)",
  "nomme(e)? (a la|au|directeur|directrice|president|presidente|dirigeant|dg)",
  "nomination",
  "prend la (direction|tete|presidence)",
  "succede",
  "levee de fonds|leve \\d|leve des fonds|serie [abc]",
  "rachat (d-|de|du)|rachete|acquiert|a acquis|acquisition (d-|de|du)",
  "remport\\w*",
  "signe (un|une) (contrat|accord|partenariat)",
  "lancement|lanc(e|era|ent) (un|une|son|sa|ses|notre|nos|le|la|les)",
  "deploie (un|une|son|sa)|refonte (du|de) (son|notre)? ?site",
];
const EVENT = new RegExp(`\\b(?:${EVENT_FORMS.map((form) => `(?:${form})`).join("|")})`);

/**
 * Présentation de soi : historique, fondation, valeurs. « Fondée en 1969 »
 * est daté, mais ce n'est pas une actualité : c'est l'âge de l'entreprise.
 */
const SELF_PRESENTATION =
  /\b(fonde(e|es)? (en|par|il y a)|cree(e|es)? (en|par|il y a)|depuis (19|20)\d{2}|depuis (plus de )?\d+ ans|plus de \d+ ans|notre histoire|qui sommes-nous|a propos|nos valeurs|notre (mission|savoir-faire|equipe|expertise)|entreprise familiale)\b/;

/** Événements historiques (« lancée en 1987 ») : ils datent l'entreprise, pas l'actualité. */
const HISTORIC =
  /\b(fonde|cree|lance|ouvert|installe|implante|rachete|inaugure)(e|es|s)? (en|depuis) (19|20)\d{2}\b/g;

/** Recrutement sur une offre précise : intitulé ou catégorie connus. */
function isSpecificJob(signal: ProspectSignal): boolean {
  return Boolean(signal.jobTitle) || (signal.structured === true && typeof signal.category === "string");
}

/**
 * `true` quand le signal atteste un événement datable, pas une présentation.
 *
 * `page` : nature de la page source. Sur une page carrière GÉNÉRIQUE,
 * l'intitulé deviné par expression régulière n'est pas fiable (« Nous
 * recrutons régulièrement des profils techniques » donnait « Poste ouvert :
 * régulièrement des profils… ») ; seule l'extraction structurée, qui cite
 * l'offre, y prouve un poste précis.
 */
export function isDatableEvent(signal: ProspectSignal, page: SiteFact["page"] | null = null): boolean {
  const guessedOnListing = page === "recrutement" && signal.structured !== true;
  if (signal.type === "recrutement" && isSpecificJob(signal) && !guessedOnListing) return true;
  const text = normalize(signal.quote ?? "").replace(HISTORIC, " ");
  return EVENT.test(text);
}

/**
 * Ne concerne que les signaux PROUVÉS par une page : les déductions INSEE et
 * les annonces officielles (BODACC, France Travail) n'ont pas de page à juger.
 */
function isWebSignal(signal: ProspectSignal): boolean {
  return Boolean(signal.url && signal.quote) && signal.type !== "structure";
}

/**
 * Sépare les vrais signaux des faits « site ».
 *
 * Un événement datable reste un signal, où qu'il soit publié. Sinon, le signal
 * devient un fait « site » quand il vient d'une page institutionnelle (URL ou
 * titre), que sa citation n'est qu'une présentation de soi, ou qu'il est du
 * type fourre-tout « presse » (événement « autre » de l'extraction). Le reste
 * — un article qui cite un recrutement, une boutique en ligne — ne change pas.
 */
export function separateSiteFacts(
  signals: readonly ProspectSignal[],
  results: readonly WebResult[] = [],
): { signals: ProspectSignal[]; siteFacts: SiteFact[] } {
  const titles = new Map(results.map((result) => [result.url, result.title]));
  const kept: ProspectSignal[] = [];
  const siteFacts: SiteFact[] = [];

  for (const signal of signals) {
    if (!isWebSignal(signal)) {
      kept.push(signal);
      continue;
    }
    const url = signal.url as string;
    const quote = signal.quote as string;
    const page = genericPageKind(url, titles.get(url) ?? "");
    if (isDatableEvent(signal, page)) {
      kept.push(signal);
      continue;
    }
    const selfPresentation = SELF_PRESENTATION.test(normalize(quote));
    if (page || selfPresentation || signal.type === "presse") {
      siteFacts.push({ text: quote, url, page: page ?? "autre" });
    } else {
      kept.push(signal);
    }
  }

  return { signals: kept, siteFacts: dedupeFacts(siteFacts) };
}

/** Une même phrase lue deux fois (scan puis extraction) ne compte qu'une fois. */
export function dedupeFacts(facts: readonly SiteFact[], max = 6): SiteFact[] {
  const seen = new Set<string>();
  const unique: SiteFact[] = [];
  for (const fact of facts) {
    const key = normalize(fact.text);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(fact);
  }
  return unique.slice(0, max);
}
