import { decodeBody } from "@/lib/enrichment/charset";
import { USER_AGENT } from "@/lib/enrichment/site";
import { findEmailByName } from "@/lib/enrichment/hunter";
import { chatJson } from "@/lib/ai/chat";
import { getOpenAI } from "@/lib/openai";
import { recordOpenAiUsage, recordUnitUsage } from "@/lib/usage/record";
import type { ContactDeps, HunterHit, VerifierStatus } from "./finder";
import type { CompanyIdentity } from "./types";

/**
 * Branchements réels de `ContactDeps`. Chaque appel payant laisse une ligne
 * dans `api_usage` (écran Coûts), qu'il trouve quelque chose ou non.
 */

const PAGE_TIMEOUT_MS = 6_000;
/** Modèle de départage, surchargeable : un appel court, sortie JSON. */
export const CONTACT_MODEL = () => process.env.OPENAI_MODEL_CONTACT?.trim() || "gpt-6-luna";

async function get(url: string, accept: string, timeoutMs = PAGE_TIMEOUT_MS): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: `${accept},*/*;q=0.8` },
    });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const robots = new Map<string, string[]>();

/** robots.txt respecté, comme pour la lecture du site (lib/enrichment/site.ts). */
async function allowed(url: URL): Promise<boolean> {
  if (!robots.has(url.origin)) {
    const rules: string[] = [];
    const response = await get(`${url.origin}/robots.txt`, "text/plain", 3_000);
    const text = response ? await response.text().catch(() => "") : "";
    let applies = false;
    for (const line of text.split(/\r?\n/)) {
      const [rawKey, ...rest] = line.split("#")[0].split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*" || /orion/i.test(value);
      else if (key === "disallow" && applies && value) rules.push(value);
    }
    robots.set(url.origin, rules);
  }
  return !(robots.get(url.origin) ?? []).some((rule) => rule === "/" || url.pathname.startsWith(rule));
}

/**
 * Taille lue d'une page.
 *
 * Elle etait plafonnee a 400 000 caracteres, ce qui paraissait large. Mesure sur
 * menuiseriebriol-diffusion.com (site Wix) le 28/09/2026 : la page d'accueil
 * pese 1 031 619 caracteres, l'adresse « contact@… » se trouve a l'octet 509 638
 * et le lien vers les mentions legales a 512 232. Les DEUX etaient coupes. Le
 * module concluait « aucune mention de l'entreprise » sur son propre site.
 *
 * Les constructeurs de sites embarquent des centaines de kilo-octets de JSON de
 * configuration AVANT le contenu : sur eux, une troncature basse ne garde que la
 * tuyauterie. On monte donc a 2 Mo — au-dela, la page n'est plus un document.
 */
const MAX_HTML_BYTES = 2_000_000;

async function fetchHtml(url: string): Promise<{ html: string; url: string } | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!(await allowed(parsed))) return null;
  const response = await get(url, "text/html");
  if (!response) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("html") && !type.includes("text")) return null;
  const html = decodeBody(await response.arrayBuffer(), type).slice(0, MAX_HTML_BYTES);
  return { html, url: response.url || url };
}

async function webSearch(query: string) {
  const key = process.env.LINKUP_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, depth: "standard", outputType: "searchResults", includeImages: false }),
    });
    if (!response.ok) return null;
    await recordUnitUsage({ service: "linkup", operation: "contact:search", units: 1 });
    const body = (await response.json()) as { results?: { name?: string; url?: string; content?: string }[] };
    return (body.results ?? [])
      .filter((item) => item.url)
      .slice(0, 10)
      .map((item) => ({ url: item.url as string, title: item.name ?? "", snippet: (item.content ?? "").slice(0, 600) }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function hunter<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return null;
  const query = new URLSearchParams({ ...params, api_key: key });
  const response = await get(`https://api.hunter.io/v2/${path}?${query}`, "application/json", 15_000);
  if (!response) return null;
  const body = (await response.json().catch(() => ({}))) as { data?: T };
  return body.data ?? null;
}

interface HunterDomainEmail {
  value?: string;
  type?: "personal" | "generic";
  first_name?: string | null;
  last_name?: string | null;
  sources?: { uri?: string }[];
}

export function realDeps(prospectId: string | null): ContactDeps {
  return {
    fetchHtml,
    webSearch,
    async hunterDomainSearch(domain) {
      const data = await hunter<{ emails?: HunterDomainEmail[] }>("domain-search", { domain, limit: "10" });
      const emails = (data?.emails ?? []).filter((email) => email.value);
      await recordUnitUsage({ service: "hunter", operation: `contact:domain-search:${emails.length ? "trouve" : "vide"}`, units: data ? 1 : 0, ...(data ? {} : { unitCost: 0 }), prospectId });
      return data
        ? emails.map<HunterHit>((email) => ({
            email: (email.value as string).toLowerCase(),
            type: email.type ?? null,
            firstName: email.first_name ?? null,
            lastName: email.last_name ?? null,
            sources: (email.sources ?? []).map((source) => source.uri).filter((uri): uri is string => Boolean(uri)),
          }))
        : null;
    },
    async hunterFinder(domain, firstName, lastName) {
      // Client existant : il trace déjà son appel dans api_usage.
      const found = await findEmailByName(domain, firstName, lastName, prospectId);
      return found.ok && found.data ? { email: found.data.email.toLowerCase() } : null;
    },
    async hunterVerify(email) {
      const data = await hunter<{ status?: VerifierStatus }>("email-verifier", { email });
      await recordUnitUsage({ service: "hunter", operation: `contact:email-verifier:${data?.status ?? "erreur"}`, units: data ? 1 : 0, ...(data ? {} : { unitCost: 0 }), prospectId });
      return data?.status ?? null;
    },
    async pickDomain(company, options) {
      if (!process.env.OPENAI_API_KEY) return null;
      try {
        const raw = await chatJson({
          client: getOpenAI(),
          role: "judge",
          model: CONTACT_MODEL(),
          temperature: 0,
          maxOutputTokens: 200,
          operation: "contact:pick-domain",
          system:
            "Tu départages des sites web candidats pour UNE entreprise française. Réponds en JSON " +
            '{"domain": "<domaine>" | null}. null si aucun extrait ne désigne clairement cette entreprise.',
          user: pickPrompt(company, options),
          onUsage: (usage) => recordOpenAiUsage({ ...usage, prospectId }),
        });
        const domain = (JSON.parse(raw) as { domain?: unknown }).domain;
        return typeof domain === "string" && options.some((option) => option.domain === domain) ? domain : null;
      } catch {
        return null;
      }
    },
  };
}

function pickPrompt(company: CompanyIdentity, options: { domain: string; excerpt: string }[]): string {
  return [
    `Raison sociale : ${company.legalName}`,
    `Noms commerciaux : ${company.tradeNames.join(", ") || "aucun"}`,
    `SIREN : ${company.siren ?? "inconnu"} · Ville : ${company.city ?? "inconnue"} ${company.postalCode ?? ""}`,
    `Dirigeant : ${company.leader ? `${company.leader.firstName} ${company.leader.lastName}` : "inconnu"}`,
    "",
    ...options.map((option) => `### ${option.domain}\n${option.excerpt}`),
  ].join("\n");
}
