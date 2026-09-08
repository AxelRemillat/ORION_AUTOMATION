/**
 * Client Linkup — recherche web utilisée pour détecter des SIGNAUX d'actualité
 * (recrutements, levée de fonds, refonte, croissance…).
 * Les résultats bruts sont ensuite qualifiés par `signals.ts`.
 */
import { fetchJson } from "./http";
import type { Result } from "./http";

const SEARCH_URL = "https://api.linkup.so/v1/search";

interface LinkupApiResult {
  type?: string;
  name?: string;
  url?: string;
  content?: string;
}

interface LinkupApiResponse {
  results?: LinkupApiResult[];
}

/** Résultat web normalisé, prêt à être qualifié en signal. */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export function hasLinkupKey(): boolean {
  return Boolean(process.env.LINKUP_API_KEY);
}

/**
 * Une seule requête par entreprise : Linkup est facturé à l'appel, et une
 * question large ramène déjà les pages presse, emploi et site officiel.
 */
function buildQuery(company: { name: string; city?: string | null; website?: string | null }) {
  const location = company.city ? ` à ${company.city}` : "";
  const site = company.website ? ` (${company.website})` : "";
  return (
    `Actualités récentes de l'entreprise ${company.name}${location}${site} : ` +
    `recrutements et offres d'emploi, levée de fonds, croissance et ouvertures, ` +
    `service client, boutique en ligne, refonte de site ou nouveaux outils internes.`
  );
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
    }));

  return { ok: true, data: results };
}
