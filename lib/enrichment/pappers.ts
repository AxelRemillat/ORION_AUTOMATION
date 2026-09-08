/**
 * Client Pappers — données légales et financières (effectif réel, CA, dirigeant).
 * Complète le référentiel public, qui ne donne ni chiffre d'affaires ni site web.
 * Sans PAPPERS_API_KEY, l'enrichissement est simplement sauté.
 */
import { fetchJson } from "./http";
import type { Result } from "./http";

const BASE_URL = "https://api.pappers.fr/v2/entreprise";

interface PappersFinance {
  annee?: number;
  chiffre_affaires?: number | null;
  resultat?: number | null;
  effectif?: number | null;
}

interface PappersRepresentant {
  nom_complet?: string;
  qualite?: string;
}

interface PappersResponse {
  nom_entreprise?: string;
  siren?: string;
  forme_juridique?: string;
  capital?: number | null;
  effectif?: string;
  effectif_min?: number | null;
  effectif_max?: number | null;
  code_naf?: string;
  libelle_code_naf?: string;
  domaine_activite?: string;
  site_web?: string | null;
  email?: string | null;
  date_creation?: string;
  finances?: PappersFinance[];
  representants?: PappersRepresentant[];
}

/** Ce que la couche d'enrichissement retient de Pappers. */
export interface PappersData {
  website: string | null;
  /** Absent de la plupart des réponses : Pappers ne l'expose pas pour toutes les fiches. */
  email: string | null;
  sector: string | null;
  legal_form: string | null;
  capital_eur: number | null;
  headcount: number | null;
  revenue_eur: number | null;
  revenue_year: number | null;
  net_income_eur: number | null;
  leader: string | null;
  leader_role: string | null;
}

export function hasPappersKey(): boolean {
  return Boolean(process.env.PAPPERS_API_KEY);
}

/** Retient le bilan le plus récent qui porte un chiffre d'affaires. */
function latestFinance(finances: PappersFinance[] | undefined): PappersFinance | null {
  const usable = (finances ?? []).filter((f) => typeof f.annee === "number");
  if (!usable.length) return null;
  const sorted = [...usable].sort((a, b) => (b.annee ?? 0) - (a.annee ?? 0));
  return sorted.find((f) => f.chiffre_affaires != null) ?? sorted[0];
}

export async function fetchPappers(siren: string): Promise<Result<PappersData>> {
  const token = process.env.PAPPERS_API_KEY;
  if (!token) return { ok: false, error: "PAPPERS_API_KEY absente" };

  const params = new URLSearchParams({ api_token: token, siren });
  const response = await fetchJson<PappersResponse>(`${BASE_URL}?${params}`);
  if (!response.ok) return response;

  const raw = response.data;
  const finance = latestFinance(raw.finances);
  const leader = raw.representants?.[0];

  return {
    ok: true,
    data: {
      website: raw.site_web?.trim() || null,
      email: raw.email?.trim() || null,
      sector: raw.libelle_code_naf ?? raw.domaine_activite ?? null,
      legal_form: raw.forme_juridique ?? null,
      capital_eur: raw.capital ?? null,
      headcount: finance?.effectif ?? raw.effectif_max ?? raw.effectif_min ?? null,
      revenue_eur: finance?.chiffre_affaires ?? null,
      revenue_year: finance?.chiffre_affaires != null ? (finance.annee ?? null) : null,
      net_income_eur: finance?.resultat ?? null,
      leader: leader?.nom_complet ?? null,
      leader_role: leader?.qualite ?? null,
    },
  };
}
