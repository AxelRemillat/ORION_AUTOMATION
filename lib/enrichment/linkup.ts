/**
 * Client Linkup — recherche web servant a detecter des SIGNAUX d'actualite.
 *
 * La requete est volontairement NEUTRE. Une version precedente enumerait les
 * evenements recherches ("levee de fonds, recrutements, croissance...") : le
 * moteur renvoyait alors des pages ou ces termes apparaissaient sans concerner
 * l'entreprise, et la qualification les prenait pour des confirmations. On
 * demande donc simplement l'actualite de l'entreprise, et c'est `signals.ts`
 * qui decide, preuve en main, s'il y a un evenement.
 */
import { fetchJson } from "./http";
import { recordUnitUsage } from "@/lib/usage/record";
import { linkupFetchCost } from "@/lib/usage/pricing";
import type { Result } from "./http";

const SEARCH_URL = "https://api.linkup.so/v1/search";

interface LinkupApiResult {
  type?: string;
  name?: string;
  url?: string;
  content?: string;
  /** Certaines sources datent leurs resultats ; on le conserve tel quel. */
  date?: string;
  publishedDate?: string;
}

interface LinkupApiResponse {
  results?: LinkupApiResult[];
}

/** Resultat web normalise, pret a etre qualifie en signal. */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  /** Date de publication si la source la fournit. */
  date?: string;
}

export function hasLinkupKey(): boolean {
  return Boolean(process.env.LINKUP_API_KEY);
}

/**
 * Requete neutre : le nom de l'entreprise, sa ville, et rien qui suggere un
 * evenement. Le nom est entre guillemets pour que le moteur privilegie les
 * pages qui le contiennent reellement.
 */
export function buildQuery(company: {
  name: string;
  city?: string | null;
  website?: string | null;
}): string {
  const parts = [`"${company.name}"`];
  if (company.city) parts.push(company.city);
  parts.push("actualité entreprise");
  return parts.join(" ");
}

export async function fetchWebResults(company: {
  name: string;
  city?: string | null;
  website?: string | null;
}): Promise<Result<WebResult[]>> {
  const key = process.env.LINKUP_API_KEY;
  if (!key) return { ok: false, error: "LINKUP_API_KEY absente" };

  const response = await fetchJson<LinkupApiResponse>(
    SEARCH_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        q: buildQuery(company),
        depth: "standard",
        outputType: "searchResults",
        includeImages: false,
      }),
    },
    15_000,
  );
  // Linkup ne facture pas les requetes en echec : on ne journalise que le succes.
  if (response.ok) {
    await recordUnitUsage({ service: "linkup", operation: "search", units: 1 });
  }
  if (!response.ok) return response;

  const results = (response.data.results ?? [])
    .filter((item) => item.url && (item.name || item.content))
    .slice(0, 12)
    .map((item) => ({
      title: (item.name ?? "").trim(),
      url: item.url as string,
      snippet: (item.content ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
      date: item.publishedDate ?? item.date,
    }));

  return { ok: true, data: results };
}

/** Contenu texte d'une page du site du prospect. */
export interface PageContent {
  url: string;
  /** Markdown nettoye, tronque. */
  markdown: string;
}

/** Chemins ou l'on trouve, en francais, ce que fait vraiment l'entreprise. */
const ABOUT_PATHS = ["/services", "/nos-services", "/activites", "/a-propos", "/qui-sommes-nous"];

/** Longueur retenue par page : assez pour comprendre le metier, pas plus. */
const PAGE_CHARS = 2_500;

/**
 * Lit une page du site du prospect via Linkup /v1/fetch.
 *
 * Mode standard sans rendu JS : c'est dix fois moins cher qu'une recherche
 * (0,001 $ contre 0,005 $) et suffisant pour du contenu editorial. Le cout est
 * journalise separement du tarif « recherche », qui ne s'applique pas ici.
 */
export async function fetchPage(url: string, prospectId?: string | null): Promise<Result<PageContent>> {
  const key = process.env.LINKUP_API_KEY;
  if (!key) return { ok: false, error: "LINKUP_API_KEY absente" };

  const response = await fetchJson<{ markdown?: string }>(
    "https://api.linkup.so/v1/fetch",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, mode: "standard", renderJs: false }),
    },
    15_000,
  );

  if (response.ok) {
    await recordUnitUsage({
      service: "linkup",
      operation: "fetch",
      units: 1,
      unitCost: linkupFetchCost(),
      prospectId,
    });
  }
  if (!response.ok) return response;

  const markdown = (response.data.markdown ?? "").replace(/\n{3,}/g, "\n\n").trim();
  if (!markdown) return { ok: false, error: "page vide" };

  return { ok: true, data: { url, markdown: markdown.slice(0, PAGE_CHARS) } };
}

/**
 * Accueil + une page « services / a propos ».
 *
 * Deux pages au maximum, en parallele : c'est le meilleur rapport
 * comprehension / cout. Une page qui echoue n'empeche pas l'autre.
 */
export async function fetchSiteContent(
  website: string,
  prospectId?: string | null,
): Promise<PageContent[]> {
  let origin: string;
  try {
    origin = new URL(website.startsWith("http") ? website : `https://${website}`).origin;
  } catch {
    return [];
  }

  const home = await fetchPage(origin, prospectId);
  const pages: PageContent[] = home.ok ? [home.data] : [];

  // On ne tente qu'UNE page secondaire : deviner cinq chemins couterait cinq
  // appels pour, au mieux, une page utile.
  const guessed = ABOUT_PATHS.find((path) => home.ok && home.data.markdown.includes(path));
  const secondary = await fetchPage(`${origin}${guessed ?? ABOUT_PATHS[0]}`, prospectId);
  if (secondary.ok) pages.push(secondary.data);

  return pages;
}
