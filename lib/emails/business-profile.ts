import { z } from "zod";

/**
 * PROFIL MÉTIER — ce que l'entreprise fait VRAIMENT, lu sur son site.
 *
 *   site (accueil, à propos, services) → PROFIL → stratège → rédacteur → juge
 *
 * Pourquoi : le stratège déduisait le pain du code NAF. BRIOL DIFFUSION
 * (46.73A, « commerce de gros de bois ») devenait un problème d'expéditions,
 * alors que c'est un menuisier fourniture + pose, trois showrooms et douze
 * commerciaux : son vrai sujet, ce sont les DEVIS. Le NAF seul ne suffit jamais.
 *
 * Le modèle LIT ; le code VÉRIFIE. Chaque chiffre d'implantation et chaque
 * service doivent être cités mot pour mot depuis une page du site — sinon ils
 * sont retirés du profil. Un profil faux ferait écrire un mail faux.
 */

export const CUSTOMER_TYPES = ["B2B", "B2C", "B2B et B2C"] as const;

const QUOTE = z.string().min(3).max(300);

export const PROFILE_SCHEMA = z.object({
  /** Ce qu'ils vendent, en une phrase de métier (pas leur slogan). */
  offer: z.string().min(5).max(240),
  customers: z.enum(CUSTOMER_TYPES),
  /** À qui précisément : « particuliers en rénovation », « artisans du BTP ». */
  customerDetail: z.string().max(160).nullable().optional(),
  /** Comment arrivent commandes et devis : formulaire, showroom, téléphone… */
  demandChannels: z.array(z.string().min(2).max(120)).max(6),
  /** Implantations et forces commerciales, chacune prouvée par une citation. */
  counts: z
    .array(z.object({ label: z.string().min(2).max(60), count: z.number().int().positive().max(100_000), quote: QUOTE }))
    .max(6),
  /** Services annexes : click & collect, traiteur, pose, livraison… */
  services: z.array(z.object({ name: z.string().min(2).max(80), quote: QUOTE })).max(8),
  /** Nom commercial employé sur le site, s'il diffère de la raison sociale. */
  commercialName: z.string().min(2).max(80).nullable().optional(),
});

export type RawBusinessProfile = z.infer<typeof PROFILE_SCHEMA>;

export interface BusinessProfile extends RawBusinessProfile {
  /** Pages lues, pour la fiche et le débogage. */
  sources: string[];
  /** Éléments retirés faute de citation retrouvée sur le site. */
  dropped: string[];
}

export interface ProfilePage {
  url: string;
  text: string;
}

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Nombres écrits en lettres, jusqu'à ce qu'une PME affiche sur son site. */
const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30,
  quarantaine: 40, cinquantaine: 50, douzaine: 12, dizaine: 10, vingtaine: 20, trentaine: 30, centaine: 100,
};

/** Les nombres présents dans une citation, chiffres et lettres. */
export function numbersInQuote(quote: string): number[] {
  const text = normalize(quote);
  const digits = [...text.matchAll(/\d+/g)].map((match) => Number(match[0]));
  const words = text.split(/[^a-z]+/).flatMap((word) => (word in NUMBER_WORDS ? [NUMBER_WORDS[word]] : []));
  return [...digits, ...words];
}

/**
 * Garde-fou : ne garde que ce que le site dit vraiment.
 * - un compte n'est retenu que si sa citation est dans une page ET porte le nombre ;
 * - un service n'est retenu que si sa citation est dans une page ;
 * - un nom commercial n'est retenu que s'il apparaît dans une page.
 */
export function groundProfile(raw: RawBusinessProfile, pages: ProfilePage[]): BusinessProfile {
  const corpus = normalize(pages.map((page) => page.text).join("\n"));
  const inSite = (quote: string) => corpus.includes(normalize(quote));
  const dropped: string[] = [];

  const counts = raw.counts.filter((item) => {
    const ok = inSite(item.quote) && numbersInQuote(item.quote).includes(item.count);
    if (!ok) dropped.push(`${item.count} ${item.label} (citation introuvable)`);
    return ok;
  });
  const services = raw.services.filter((item) => {
    const ok = inSite(item.quote);
    if (!ok) dropped.push(`service « ${item.name} » (citation introuvable)`);
    return ok;
  });
  const commercialName = raw.commercialName && inSite(raw.commercialName) ? raw.commercialName.trim() : null;
  if (raw.commercialName && !commercialName) dropped.push(`nom commercial « ${raw.commercialName} » absent du site`);

  return { ...raw, counts, services, commercialName, sources: pages.map((page) => page.url), dropped };
}

/** « 3 showrooms, 12 commerciaux » — la forme d'un fait d'accroche structurel. */
export function locationsLine(profile: Pick<BusinessProfile, "counts">): string | null {
  return profile.counts.length ? profile.counts.map((item) => `${item.count} ${item.label}`).join(", ") : null;
}

/** Bloc lisible du profil, pour le stratège. */
export function profileBlock(profile: BusinessProfile | null): string {
  if (!profile) {
    return "PROFIL METIER : non disponible (site non lu). Le NAF seul ne suffit pas a choisir le pain : reste prudent.";
  }
  return [
    "PROFIL METIER — lu sur leur site, verifie par le code. C'est LUI qui dit leur metier, pas le NAF :",
    `- Ce qu'ils vendent : ${profile.offer}`,
    `- Clientele : ${profile.customers}${profile.customerDetail ? ` (${profile.customerDetail})` : ""}`,
    `- Arrivee des commandes / devis : ${profile.demandChannels.join(" ; ") || "non precise"}`,
    `- Implantations et equipe : ${locationsLine(profile) ?? "non precise"}`,
    `- Services : ${profile.services.map((item) => item.name).join(", ") || "aucun releve"}`,
    profile.commercialName ? `- Nom commercial : ${profile.commercialName}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const MAX_PAGE_CHARS = 3_500;

export function buildProfilePrompt(companyName: string, pages: ProfilePage[]): { system: string; user: string } {
  const system = `Tu lis le site d'une PME francaise et tu decris son METIER REEL, pour un freelance
qui automatise des taches. Tu ne rediges rien d'autre.

Tu rends UNIQUEMENT un objet JSON :
{
  "offer": "ce qu'ils vendent, en une phrase de metier (fourniture et pose de menuiseries, boulangerie-patisserie artisanale...)",
  "customers": "B2B" | "B2C" | "B2B et B2C",
  "customerDetail": "a qui precisement, ou null",
  "demandChannels": ["comment arrivent commandes et devis : formulaire de devis en ligne, showroom, telephone, commerciaux terrain, boutique..."],
  "counts": [ { "label": "showrooms", "count": 3, "quote": "phrase EXACTE du site qui porte ce nombre" } ],
  "services": [ { "name": "pose", "quote": "phrase EXACTE du site" } ],
  "commercialName": "nom commercial utilise sur le site s'il differe de la raison sociale, sinon null"
}

REGLES
- "counts" : sites, showrooms, boutiques, agences, magasins, laboratoires, commerciaux, techniciens...
  Chaque entree porte une citation COPIEE MOT POUR MOT du site, contenant le nombre. Pas de citation, pas d'entree.
- "services" : click & collect, traiteur, pose, livraison, SAV, devis en ligne... Citation exacte obligatoire.
- N'invente rien. Ce que le site ne dit pas reste vide ou null.
- Pas de slogan : « leader », « excellence », « passion » ne decrivent pas un metier.`;

  const user = `Entreprise : ${companyName}

${pages.map((page, index) => `--- PAGE ${index + 1} : ${page.url} ---\n${page.text.slice(0, MAX_PAGE_CHARS)}`).join("\n\n")}`;
  return { system, user };
}

/** Parse + garde-fou. `null` si la sortie est inexploitable. */
export function parseProfile(raw: string, pages: ProfilePage[]): BusinessProfile | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = PROFILE_SCHEMA.safeParse(json);
  return parsed.success ? groundProfile(parsed.data, pages) : null;
}

/** Lecture d'un profil stocké en base (jsonb), tolérante aux anciennes formes. */
export function storedProfile(value: unknown): BusinessProfile | null {
  if (!value || typeof value !== "object") return null;
  const parsed = PROFILE_SCHEMA.safeParse(value);
  if (!parsed.success) return null;
  const extra = value as { sources?: unknown; dropped?: unknown };
  const list = (items: unknown) => (Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : []);
  return { ...parsed.data, sources: list(extra.sources), dropped: list(extra.dropped) };
}

/** Un profil de plus de 30 jours se relit : un site bouge. */
export const PROFILE_MAX_AGE_DAYS = 30;

export function profileIsFresh(at: string | null | undefined, now = new Date()): boolean {
  if (!at) return false;
  return now.getTime() - Date.parse(at) < PROFILE_MAX_AGE_DAYS * 86_400_000;
}

export type ProfileAsk = (system: string, user: string, operation: string) => Promise<string>;

/** Un appel au modèle, plus UNE reprise si la sortie n'est pas un JSON conforme. */
export async function extractProfile(ask: ProfileAsk, companyName: string, pages: ProfilePage[]): Promise<BusinessProfile | null> {
  if (!pages.length) return null;
  const { system, user } = buildProfilePrompt(companyName, pages);
  const first = parseProfile(await ask(system, user, "profil-metier"), pages);
  if (first) return first;
  return parseProfile(
    await ask(system, `${user}\n\nTa reponse precedente n'etait pas un JSON conforme au schema. Recommence.`, "profil-metier:retry"),
    pages,
  );
}
