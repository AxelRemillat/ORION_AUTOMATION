/**
 * Datation d'un signal.
 *
 * Un signal non daté ne prouve pas une actualité : il peut avoir dix ans.
 * L'app affichait pourtant « recrute un automaticien » sans savoir si l'offre
 * datait de mardi ou de 2019, et le score de chaleur appliquait quand même un
 * facteur de récence favorable. On résout donc la date dans un ordre explicite,
 * on conserve D'OÙ elle vient, et on assume le `null` quand rien ne permet de
 * dater — auquel cas l'UI écrit « non daté » et le score ne compte pas le
 * signal.
 *
 * Ordre de résolution, du plus fiable au plus douteux :
 *   1. date de publication renvoyée par la source (Linkup) ;
 *   2. date explicite dans le texte, y compris relative (« il y a 3 jours »)
 *      rapportée à la date de crawl ;
 *   3. motif de date dans l'URL (/2026/03/12/, -20260312-).
 */

export type DateBasis = "source" | "texte" | "url";

export interface ResolvedDate {
  /** Date ISO (AAAA-MM-JJ), ou `null` si indatable. */
  date: string | null;
  /** D'où vient la date retenue. `null` quand `date` l'est aussi. */
  basis: DateBasis | null;
}

/** Fenêtre de fraîcheur : au-delà, un signal ne vaut plus comme actualité. */
export const FRESH_DAYS = 60;

const DAY_MS = 86_400_000;

const MONTHS_FR = [
  "janvier", "fevrier", "mars", "avril", "mai", "juin",
  "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
];

const MONTHS_FR_DISPLAY = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

const deaccent = (text: string): string =>
  text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Construit une date ISO si les composants forment un jour réel. */
function isoOf(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 1990 || year > 2100) return null;
  return date.toISOString().slice(0, 10);
}

/** Date fournie par la source : souvent ISO complet, parfois juste un jour. */
export function parseSourceDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Date explicite ou relative trouvée dans un texte.
 * `now` sert de référence aux formes relatives : c'est la date de crawl, pas
 * la date de lecture, sans quoi « il y a 3 jours » glisserait à chaque affichage.
 */
export function parseTextDate(text: string, now: Date): string | null {
  const flat = deaccent(text).replace(/\s+/g, " ");

  // 12/03/2026 ou 12-03-2026
  const numeric = flat.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (numeric) return isoOf(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));

  // 2026-03-12
  const iso = flat.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // 12 mars 2026, éventuellement précédé de « publié le ».
  const long = flat.match(
    new RegExp(`\\b(\\d{1,2})(?:er)? (${MONTHS_FR.join("|")})\\.? (20\\d{2})\\b`),
  );
  if (long) return isoOf(Number(long[3]), MONTHS_FR.indexOf(long[2]) + 1, Number(long[1]));

  // « il y a 3 jours / 2 semaines / 1 mois », « publiée hier »
  const relative = flat.match(/il y a (\d{1,3}) (jour|semaine|mois|an)/);
  if (relative) {
    const count = Number(relative[1]);
    const unit = relative[2];
    const days = unit === "jour" ? count : unit === "semaine" ? count * 7 : unit === "mois" ? count * 30 : count * 365;
    return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  }
  if (/\bhier\b/.test(flat)) return new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
  if (/\baujourd'hui\b/.test(flat)) return new Date(now.getTime()).toISOString().slice(0, 10);

  return null;
}

/** Motif de date dans une URL : /2026/03/12/, _2026-03-12, -20260312-. */
export function parseUrlDate(url: string): string | null {
  const slashes = url.match(/\/(20\d{2})\/(\d{1,2})(?:\/(\d{1,2}))?(?:\/|$|[-_])/);
  if (slashes) {
    return isoOf(Number(slashes[1]), Number(slashes[2]), Number(slashes[3] ?? 1));
  }
  const dashed = url.match(/[-_](20\d{2})[-_](\d{2})[-_](\d{2})\b/);
  if (dashed) return isoOf(Number(dashed[1]), Number(dashed[2]), Number(dashed[3]));

  const compact = url.match(/[-_/](20\d{2})(\d{2})(\d{2})(?:[-_/.]|$)/);
  if (compact) return isoOf(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  return null;
}

/** Applique l'ordre de résolution et dit sur quoi la date retenue s'appuie. */
export function resolvePostedAt(input: {
  sourceDate?: string | null;
  text?: string | null;
  url?: string | null;
  /** Date de crawl : référence des formes relatives. */
  now?: Date;
}): ResolvedDate {
  const now = input.now ?? new Date();

  const fromSource = parseSourceDate(input.sourceDate);
  if (fromSource) return { date: fromSource, basis: "source" };

  const fromText = input.text ? parseTextDate(input.text, now) : null;
  if (fromText) return { date: fromText, basis: "texte" };

  const fromUrl = input.url ? parseUrlDate(input.url) : null;
  if (fromUrl) return { date: fromUrl, basis: "url" };

  return { date: null, basis: null };
}

/** Âge en jours d'une date ISO, `null` si indatable. */
export function ageInDays(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return (now.getTime() - parsed) / DAY_MS;
}

/**
 * Un signal est FRAIS s'il est daté et vieux de moins de 60 jours.
 * Non daté ⇒ jamais frais : c'est la règle qui empêche une offre d'emploi de
 * 2019 de porter une accroche « ils recrutent en ce moment ».
 */
export function isFresh(iso: string | null | undefined, now = new Date()): boolean {
  const age = ageInDays(iso, now);
  if (age === null) return false;
  // Une date légèrement future (fuseau de la source) reste acceptable.
  return age >= -2 && age <= FRESH_DAYS;
}

/** Date lisible en français, ou « non daté ». */
export function frenchDate(iso: string | null | undefined): string {
  if (!iso) return "non daté";
  // Une date peut arriver en horodatage complet (« 2026-09-25T15:29:27.275Z ») :
  // France Travail en renvoie. Sans cette troncature, le jour valait `NaN` et
  // l'ecran affichait « NaN septembre 2026 ».
  const [year, month, day] = iso.slice(0, 10).split("-");
  const index = Number(month) - 1;
  if (!year || Number.isNaN(index) || !MONTHS_FR_DISPLAY[index]) return iso;
  return `${Number(day)} ${MONTHS_FR_DISPLAY[index]} ${year}`;
}

/**
 * Age d'une entreprise, CALCULE A UN SEUL ENDROIT.
 *
 * La fiche affichait « 57 ans » ici et « 58 ans » la : deux soustractions
 * differentes, l'une sur l'annee seule, l'autre sur la date complete. Cette
 * fonction est desormais la seule autorisee. Avec la date complete de creation
 * l'age est exact ; avec l'annee seule, c'est une difference d'annees, et le
 * libelle le dit (« depuis 1968 »).
 */
export function companyAge(
  input: { foundedOn?: string | null; foundedYear?: number | null },
  now = new Date(),
): { years: number; exact: boolean } | null {
  const iso = input.foundedOn ?? null;
  if (iso) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) {
      let years = now.getUTCFullYear() - parsed.getUTCFullYear();
      const monthDiff = now.getUTCMonth() - parsed.getUTCMonth();
      if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < parsed.getUTCDate())) {
        years -= 1;
      }
      if (years >= 0) return { years, exact: true };
    }
  }
  const year = input.foundedYear ?? null;
  if (year && year > 1700) return { years: now.getUTCFullYear() - year, exact: false };
  return null;
}
