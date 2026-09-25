/**
 * Client Pappers — données légales et financières (effectif réel, CA, dirigeant).
 * Complète le référentiel public, qui ne donne ni chiffre d'affaires ni site web.
 * Sans PAPPERS_API_KEY, l'enrichissement est simplement sauté.
 */
import { fetchJson } from "./http";
import { recordUnitUsage } from "@/lib/usage/record";
import { cached } from "./cache";
import { readPappersHeadcount } from "./headcount";
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
  /** `true` quand le représentant est une société (holding, SC familiale…). */
  personne_morale?: boolean;
  /** SIREN du représentant, renseigné pour une personne morale. */
  siren?: string | null;
  nom?: string;
  prenom?: string;
  prenoms?: string;
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

/**
 * Représentant légal PUBLIC de l'entreprise.
 *
 * Volontairement limité aux représentants légaux : les bénéficiaires
 * effectifs ne sont pas lus, ni demandés. Leur accès est restreint depuis la
 * décision CJUE du 22 novembre 2022, et une prospection commerciale n'entre
 * dans aucun des cas d'accès prévus.
 */
export interface PappersRepresentative {
  name: string;
  role: string | null;
  isCompany: boolean;
  /** SIREN de la société représentante, pour remonter d'un cran. */
  siren: string | null;
  /** Prénom et nom séparés, quand c'est une personne physique. */
  firstName: string | null;
  lastName: string | null;
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
  /** Tous les représentants légaux, personnes physiques ET morales. */
  representatives: PappersRepresentative[];
}

export function hasPappersKey(): boolean {
  return Boolean(process.env.PAPPERS_API_KEY);
}

/** Casse naturelle : l'API renvoie « DUPONT », inutilisable dans un mail. */
function properCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/([\s-])/)
    .map((part) => (/[\s-]/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/** Normalise la liste des représentants légaux. */
function mapRepresentatives(raw: PappersRepresentant[] | undefined): PappersRepresentative[] {
  return (raw ?? [])
    .map((item) => {
      const isCompany = Boolean(item.personne_morale ?? (item.siren && !item.nom));
      const firstName = (item.prenom ?? item.prenoms ?? "").trim().split(/\s+/)[0] || null;
      const lastName = item.nom?.trim() || null;
      const name =
        item.nom_complet?.trim() ||
        [firstName, lastName].filter(Boolean).join(" ").trim();
      if (!name) return null;
      return {
        name: isCompany ? name : properCase(name),
        role: item.qualite?.trim() || null,
        isCompany,
        siren: item.siren?.replace(/\s/g, "") || null,
        firstName: isCompany || !firstName ? null : properCase(firstName),
        lastName: isCompany || !lastName ? null : properCase(lastName),
      };
    })
    .filter((item): item is PappersRepresentative => item !== null);
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
  // Pappers debite 1 credit par fiche entreprise, meme si on n'en exploite
  // qu'une partie. On journalise l'appel reel, pas ce qu'on en a tire.
  if (response.ok) {
    await recordUnitUsage({ service: "pappers", operation: "entreprise", units: 1 });
  }
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
      // `effectif_max` seul est un piege : il vaut 500000 pour une fourchette
      // ouverte (« Au moins 1 salarie »), et c'est ce chiffre qui s'affichait.
      headcount: readPappersHeadcount({
        financeHeadcount: finance?.effectif,
        min: raw.effectif_min,
        max: raw.effectif_max,
      }).value,
      revenue_eur: finance?.chiffre_affaires ?? null,
      revenue_year: finance?.chiffre_affaires != null ? (finance.annee ?? null) : null,
      net_income_eur: finance?.resultat ?? null,
      leader: leader?.nom_complet ?? null,
      leader_role: leader?.qualite ?? null,
      representatives: mapRepresentatives(raw.representants),
    },
  };
}

/**
 * Profil d'une société REPRÉSENTANTE (holding, SC familiale, société mère).
 *
 * Coûte un crédit Pappers de plus, d'où le cache 30 jours : une holding
 * détient souvent plusieurs cibles, et ses données ne bougent pas d'un mois
 * sur l'autre. N'est appelé que sur les entreprises retenues en phase 2.
 */
export interface HoldingProfile {
  siren: string;
  name: string | null;
  /** Représentants personnes physiques de la holding : le vrai dirigeant. */
  people: PappersRepresentative[];
  revenue_eur: number | null;
  headcount: number | null;
}

export async function fetchHoldingProfile(siren: string): Promise<HoldingProfile | null> {
  const clean = siren.replace(/\s/g, "");
  if (!/^\d{9}$/.test(clean)) return null;

  return cached<HoldingProfile>(`pappers:holding:${clean}`, async () => {
    const response = await fetchPappers(clean);
    if (!response.ok) return null;
    const data = response.data;
    return {
      siren: clean,
      name: null,
      people: data.representatives.filter((item) => !item.isCompany),
      revenue_eur: data.revenue_eur,
      headcount: data.headcount,
    };
  });
}
