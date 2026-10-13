import type { IngestBody } from "./ingest";

/**
 * FLUX RSS OFFICIELS CODEUR (Cowork #27) — lecture seule, rien d'autre que les flux
 * publics que le workflow n8n lit déjà. Sert au RATTRAPAGE : retrouver le texte, le
 * budget et les catégories d'une annonce restée « titre seul » (alerte e-mail arrivée
 * avant le flux). Aucune page Codeur n'est lue.
 *
 * Format d'un item : <guid>491216</guid>, <title>, <link>, <pubDate>, et une description
 * HTML dont le 1er paragraphe porte « Budget : 500 € à 1 000 € - Catégories : CSS, HTML… ».
 */

export const CODEUR_FEEDS = ["https://www.codeur.com/projects.rss", "https://www.codeur.com/projects/c/web.rss"] as const;

const decode = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const tag = (item: string, name: string) => item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "";
const text = (html: string) => decode(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Items d'un flux Codeur, au format d'ingestion (source RSS). */
export function parseCodeurRss(xml: string): IngestBody[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.flatMap((item): IngestBody[] => {
    const externalId = text(tag(item, "guid"));
    // Les titres arrivent doublement échappés (« d&amp;#39;un ») : on décode deux fois.
    const title = text(decode(tag(item, "title")));
    if (!externalId || !title) return [];
    const html = decode(tag(item, "description"));
    const paragraphs = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((match) => text(match[1]));
    const head = paragraphs[0] ?? "";
    const budget = head.match(/Budget\s*:\s*(.+?)(?:\s+-\s+Cat[ée]gories|$)/i)?.[1]?.trim() ?? null;
    const categories = (head.match(/Cat[ée]gories\s*:\s*(.+)$/i)?.[1] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const description = paragraphs.slice(1).filter((value) => !/^Voir ce projet sur Codeur$/i.test(value)).join("\n\n").trim();
    const published = Date.parse(text(tag(item, "pubDate")));
    const link = text(tag(item, "link"));
    return [
      {
        platform: "codeur",
        external_id: externalId,
        url: /^https?:\/\//.test(link) ? link : null,
        title,
        description,
        description_truncated: /…\s*$|\.\.\.\s*$/.test(description),
        budget_text: budget,
        categories,
        published_at: Number.isNaN(published) ? null : new Date(published).toISOString(),
        source: "rss",
      },
    ];
  });
}

/** Les deux flux officiels, fusionnés par identifiant. Un flux injoignable est ignoré. */
export async function fetchCodeurFeeds(fetchFn: typeof fetch = fetch): Promise<Map<string, IngestBody>> {
  const items = new Map<string, IngestBody>();
  for (const feed of CODEUR_FEEDS) {
    try {
      const response = await fetchFn(feed, { headers: { "user-agent": "ORION veille RSS (Axel Remillat)" }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) continue;
      for (const item of parseCodeurRss(await response.text())) if (!items.has(item.external_id)) items.set(item.external_id, item);
    } catch {
      // flux injoignable : le rattrapage fait avec ce qu'il a
    }
  }
  return items;
}
