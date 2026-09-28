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
  /** Capitaux propres de l'exercice. Absent quand les comptes sont confidentiels. */
  fonds_propres?: number | null;
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
  /** Date de nomination. C'est elle qui fait d'un dirigeant un dirigeant ENTRANT. */
  date_prise_de_poste?: string | null;
}

/**
 * Etablissement, tel que Pappers le rend.
 *
 * `date_de_creation` est la date administrative d'ouverture : c'est le
 * plancher le plus fiable qu'on ait pour « vous avez ouvert une agence a X ».
 */
interface PappersEtablissement {
  siret?: string;
  ville?: string | null;
  enseigne?: string | null;
  nom_commercial?: string | null;
  date_de_creation?: string | null;
  etablissement_cesse?: boolean;
  siege?: boolean;
}

interface PappersResponse {
  nom_entreprise?: string;
  opposition_utilisation_commerciale?: boolean;
  /** `false` quand l'entreprise n'emploie personne. */
  entreprise_employeuse?: boolean;
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
  etablissements?: PappersEtablissement[];
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
  /** Date de nomination (AAAA-MM-JJ), quand Pappers la connaît. */
  since: string | null;
}

/**
 * Ouverture d'etablissement : une ville, une date.
 *
 * C'est le signal le plus sous-exploite de Pappers. L'appel fiche entreprise
 * rend la liste COMPLETE des etablissements avec leur date de creation, alors
 * que l'annuaire public ne rend que ceux qui collent a la requete. Sur
 * SELECTION HABITAT, l'annuaire ne montrait aucune agence a Lavelanet ;
 * Pappers en montre 44, dont Lavelanet (01/02/2022) et quatre ouvertures de
 * moins d'un an. Une ouverture recente est une accroche datee, verifiable, et
 * qui ne cite aucun registre.
 */
export interface Opening {
  city: string;
  date: string;
  siret: string | null;
  /** Enseigne locale, quand elle differe de la raison sociale. */
  sign: string | null;
}

/** Ce que la couche d'enrichissement retient de Pappers. */
export interface PappersData {
  website: string | null;
  /** Absent de la plupart des réponses : Pappers ne l'expose pas pour toutes les fiches. */
  email: string | null;
  sector: string | null;
  legal_form: string | null;
  capital_eur: number | null;
  /**
   * Capitaux propres du dernier exercice publié, et `null` quand ils ne le sont
   * pas — une petite société peut déposer ses comptes en confidentialité.
   */
  equity_eur: number | null;
  /**
   * OPPOSITION À LA PROSPECTION COMMERCIALE, déclarée au registre Sirene.
   *
   * À ne pas confondre avec `statut_diffusion` de l'annuaire public, qui vaut
   * « O » pour DBP MEDICAL (844687566) alors que cette société s'oppose bel et
   * bien à l'usage commercial de ses données. Vérifié le 28/09/2026 : seul
   * Pappers porte le drapeau, sous le nom `opposition_utilisation_commerciale`.
   */
  refuses_prospecting: boolean;
  /**
   * L'entreprise n'emploie PERSONNE, et le registre le dit — a ne pas confondre
   * avec un effectif inconnu. GLOBAL 2F (833040736) : `effectif: "0 salarie"`,
   * `effectif_min: 0`, `effectif_max: 0`, `entreprise_employeuse: false`, alors
   * que l'annuaire public rend la tranche « NN », c'est-a-dire « non
   * renseigne ». Le filtre de l'etage 2, qui lit l'annuaire, ne peut donc pas le
   * savoir ; l'etage 4, si.
   */
  no_staff: boolean;
  headcount: number | null;
  revenue_eur: number | null;
  revenue_year: number | null;
  net_income_eur: number | null;
  leader: string | null;
  leader_role: string | null;
  /** Tous les représentants légaux, personnes physiques ET morales. */
  representatives: PappersRepresentative[];
  /** Date de nomination du premier représentant. */
  leader_since: string | null;
  /** Ouvertures d'établissements, de la plus récente à la plus ancienne. */
  openings: Opening[];
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
        since: item.date_prise_de_poste?.slice(0, 10) || null,
      };
    })
    .filter((item): item is PappersRepresentative => item !== null);
}

/**
 * Ouvertures d'etablissements, la plus recente d'abord.
 *
 * Le siege est ecarte : sa creation est celle de l'entreprise, pas une
 * nouvelle. Les etablissements fermes aussi — annoncer une ouverture qui a
 * depuis ferme est le genre d'erreur qui coute la reponse.
 */
function mapOpenings(raw: PappersEtablissement[] | undefined): Opening[] {
  return (raw ?? [])
    .filter((item) => item.siege !== true && item.etablissement_cesse !== true)
    .map((item) => {
      const date = item.date_de_creation?.slice(0, 10);
      const city = item.ville?.trim();
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !city) return null;
      const sign = (item.enseigne ?? item.nom_commercial ?? "")?.trim() || null;
      return { city: properCase(city), date, siret: item.siret?.trim() || null, sign };
    })
    .filter((item): item is Opening => item !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
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
      equity_eur: finance?.fonds_propres ?? null,
      refuses_prospecting: raw.opposition_utilisation_commerciale === true,
      no_staff: raw.entreprise_employeuse === false && raw.effectif_max === 0,
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
      leader_since: leader?.date_prise_de_poste?.slice(0, 10) ?? null,
      openings: mapOpenings(raw.etablissements),
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
