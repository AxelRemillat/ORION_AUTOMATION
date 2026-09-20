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
