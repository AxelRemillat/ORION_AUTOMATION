/**
 * Résolution d'une zone saisie librement vers des filtres que l'annuaire
 * comprend.
 *
 * Le bug corrigé ici : « Paris » partait en recherche PLEIN TEXTE
 * (`q=Paris`). L'annuaire renvoyait alors les entreprises dont le NOM contient
 * « Paris » — on a vu remonter des sociétés de Cadaujac, d'Arbent et de
 * Wissous — et aucun filtre géographique n'était posé. La zone n'avait donc
 * aucun effet, sinon celui de fausser les résultats.
 *
 * On passe par `geo.api.gouv.fr` (gratuit, sans clé) pour transformer la
 * saisie en codes officiels, puis on envoie à l'annuaire le filtre le plus
 * précis qu'il accepte :
 *
 *   - un numéro de département      → `departement=69`
 *   - un code postal                → `code_postal=69003`
 *   - un nom de commune             → `code_postal=` tous ses codes postaux
 *
 * Pourquoi les codes postaux et non le code INSEE de la commune : Paris, Lyon
 * et Marseille portent un code « chapeau » (69123 pour Lyon) que l'annuaire ne
 * connaît pas — vérifié, il rend 0 résultat. Leurs arrondissements ont chacun
 * leur code INSEE et leur code postal ; la liste des codes postaux les couvre
 * tous en une seule requête.
 */
import { fetchJson } from "./http";
import type { Result } from "./http";

const COMMUNES = "https://geo.api.gouv.fr/communes";
const DEPARTEMENTS = "https://geo.api.gouv.fr/departements";
const FIELDS = "nom,code,codesPostaux,departement,population";

/** Au-delà, l'URL devient déraisonnable — et aucune commune française n'y arrive. */
const MAX_POSTAL_CODES = 25;

export interface ResolvedZone {
  kind: "departement" | "commune" | "code_postal";
  /** Libellé affiché à côté du total : « Paris (75) ». */
  label: string;
  /** Paramètre de l'annuaire à poser. */
  param: "departement" | "code_postal";
  /** Valeur du paramètre, éventuellement une liste séparée par des virgules. */
  value: string;
  /** Code du département, pour l'affichage et les tests. */
  departement: string | null;
}

interface GeoCommune {
  nom?: string;
  code?: string;
  codesPostaux?: string[];
  population?: number;
  departement?: { code?: string; nom?: string };
}

interface GeoDepartement {
  nom?: string;
  code?: string;
}

const isPostalCode = (value: string): boolean => /^\d{5}$/.test(value);

/** « 69 », « 075 », « 2A ». On normalise « 075 » en « 75 ». */
function departementCode(value: string): string | null {
  const raw = value.trim().toUpperCase();
  if (/^2[AB]$/.test(raw)) return raw;
  if (/^\d{2}$/.test(raw)) return raw;
  if (/^\d{3}$/.test(raw)) {
    // 3 chiffres : soit un DOM (971-976), soit un « 075 » mal saisi.
    if (raw.startsWith("9")) return raw;
    return raw.startsWith("0") ? raw.slice(1) : null;
  }
  return null;
}

/** Codes postaux d'une commune, tronqués et dédoublonnés. */
function postalCodesOf(commune: GeoCommune): string[] {
  return [...new Set(commune.codesPostaux ?? [])].filter(isPostalCode).slice(0, MAX_POSTAL_CODES);
}

/**
 * Résout une saisie en filtre géographique.
 *
 * Renvoie `ok: false` avec un message lisible quand la zone est introuvable —
 * l'appelant doit l'afficher, surtout pas répondre 422 sans explication.
 */
export async function resolveZone(input: string): Promise<Result<ResolvedZone>> {
  const value = input.trim();
  if (!value) return { ok: false, error: "Zone vide." };

  // --- 1. Numéro de département -------------------------------------------
  const departement = departementCode(value);
  if (departement) {
    const response = await fetchJson<GeoDepartement>(`${DEPARTEMENTS}/${departement}`);
    if (!response.ok) {
      return { ok: false, error: `Département « ${value} » introuvable.` };
    }
    return {
      ok: true,
      data: {
        kind: "departement",
        label: `${response.data.nom ?? value} (${departement})`,
        param: "departement",
        value: departement,
        departement,
      },
    };
  }

  // --- 2. Code postal ------------------------------------------------------
  if (isPostalCode(value)) {
    const response = await fetchJson<GeoCommune[]>(`${COMMUNES}?codePostal=${value}&fields=${FIELDS}`);
    const commune = response.ok ? response.data[0] : undefined;
    if (!commune) {
      return { ok: false, error: `Code postal « ${value} » introuvable.` };
    }
    return {
      ok: true,
      data: {
        kind: "code_postal",
        label: `${commune.nom ?? value} (${value})`,
        param: "code_postal",
        value,
        departement: commune.departement?.code ?? null,
      },
    };
  }

  // --- 3. Nom de commune ---------------------------------------------------
  const query = encodeURIComponent(value);
  const response = await fetchJson<GeoCommune[]>(
    `${COMMUNES}?nom=${query}&fields=${FIELDS}&boost=population&limit=5`,
  );
  if (!response.ok) {
    return { ok: false, error: `Zone « ${value} » : service géographique indisponible.` };
  }

  // `boost=population` place la grande ville en tête : « Paris » doit rendre
  // Paris, pas Paris-l'Hôpital.
  const commune = response.data.find((item) => postalCodesOf(item).length > 0);
  if (!commune) {
    return {
      ok: false,
      error:
        `Zone « ${value} » introuvable. Essayez un nom de ville, un code postal ` +
        "(69003) ou un numéro de département (69).",
    };
  }

  const codes = postalCodesOf(commune);
  const dept = commune.departement?.code ?? null;
  return {
    ok: true,
    data: {
      kind: "commune",
      label: `${commune.nom ?? value}${dept ? ` (${dept})` : ""}`,
      param: "code_postal",
      value: codes.join(","),
      departement: dept,
    },
  };
}
