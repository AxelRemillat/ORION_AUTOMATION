/**
 * Client Hunter.io — recherche de l'email professionnel d'un décideur à partir
 * du domaine de l'entreprise. Optionnel : sans clé ou sans site, on n'affiche
 * simplement pas de contact.
 */
import { fetchJson } from "./http";
import type { Result } from "./http";
import type { DecisionMakerContact } from "./types";

const DOMAIN_SEARCH_URL = "https://api.hunter.io/v2/domain-search";

interface HunterEmail {
  value?: string;
  type?: string;
  confidence?: number;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  seniority?: string | null;
  department?: string | null;
}

interface HunterResponse {
  data?: { emails?: HunterEmail[] };
  errors?: { details?: string }[];
}

export function hasHunterKey(): boolean {
  return Boolean(process.env.HUNTER_API_KEY);
}

/** Priorise un décideur : nom du dirigeant connu > séniorité > confiance. */
function score(email: HunterEmail, leaderLastName: string | null): number {
  let value = email.confidence ?? 0;
  if (email.type === "personal") value += 20;
  if (leaderLastName && email.last_name?.toLowerCase() === leaderLastName) value += 200;
  if (email.seniority === "executive") value += 60;
  else if (email.seniority === "senior") value += 25;
  if (email.department && ["executive", "management"].includes(email.department)) value += 30;
  return value;
}

export async function findDecisionMaker(
  domain: string,
  leaderName?: string | null,
): Promise<Result<DecisionMakerContact | null>> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return { ok: false, error: "HUNTER_API_KEY absente" };

  const params = new URLSearchParams({ domain, api_key: key, limit: "10" });
  const response = await fetchJson<HunterResponse>(`${DOMAIN_SEARCH_URL}?${params}`);
  if (!response.ok) return response;

  const emails = (response.data.data?.emails ?? []).filter((email) => email.value);
  if (!emails.length) return { ok: true, data: null };

  const leaderLastName = leaderName?.trim().split(/\s+/).pop()?.toLowerCase() ?? null;
  const best = [...emails].sort((a, b) => score(b, leaderLastName) - score(a, leaderLastName))[0];

  const fullName = [best.first_name, best.last_name].filter(Boolean).join(" ").trim();
  return {
    ok: true,
    data: {
      email: best.value as string,
      full_name: fullName || null,
      position: best.position ?? null,
      confidence: best.confidence ?? null,
    },
  };
}
