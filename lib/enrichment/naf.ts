/**
 * Référentiels INSEE utilisés par le formulaire de recherche et par le mapping
 * des réponses de recherche-entreprises.api.gouv.fr.
 */

/** Sections NAF, filtrées sur celles qui ont un intérêt en prospection B2B. */
export const NAF_SECTIONS = [
  { code: "J", label: "Information & communication" },
  { code: "M", label: "Conseil, ingénierie, services techniques" },
  { code: "G", label: "Commerce & réparation" },
  { code: "C", label: "Industrie manufacturière" },
  { code: "F", label: "Construction" },
  { code: "N", label: "Services administratifs & soutien" },
  { code: "K", label: "Finance & assurance" },
  { code: "L", label: "Immobilier" },
  { code: "H", label: "Transport & entreposage" },
  { code: "I", label: "Hébergement & restauration" },
  { code: "Q", label: "Santé & action sociale" },
  { code: "P", label: "Enseignement" },
  { code: "S", label: "Autres services" },
  { code: "R", label: "Arts & spectacles" },
] as const;

/** Codes INSEE de tranche d'effectif salarié → libellé lisible. */
export const EFFECTIF_LABELS: Record<string, string> = {
  NN: "Effectif non renseigné",
  "00": "0 salarié",
  "01": "1 à 2 salariés",
  "02": "3 à 5 salariés",
  "03": "6 à 9 salariés",
  "11": "10 à 19 salariés",
  "12": "20 à 49 salariés",
  "21": "50 à 99 salariés",
  "22": "100 à 199 salariés",
  "31": "200 à 249 salariés",
  "32": "250 à 499 salariés",
  "41": "500 à 999 salariés",
  "42": "1 000 à 1 999 salariés",
  "51": "2 000 à 4 999 salariés",
  "52": "5 000 à 9 999 salariés",
  "53": "10 000 salariés et plus",
};

/**
 * Regroupements proposés à l'utilisateur. La cible « automatisation » se situe
 * surtout entre 10 et 250 salariés : assez de volume pour souffrir, assez petit
 * pour décider vite.
 */
export const SIZE_BUCKETS = [
  { id: "tpe", label: "1 à 9 salariés", tranches: ["01", "02", "03"] },
  { id: "petite", label: "10 à 49 salariés", tranches: ["11", "12"] },
  { id: "moyenne", label: "50 à 249 salariés", tranches: ["21", "22", "31"] },
  { id: "eti", label: "250 à 999 salariés", tranches: ["32", "41"] },
  { id: "grande", label: "1 000 salariés et plus", tranches: ["42", "51", "52", "53"] },
] as const;

export type SizeBucketId = (typeof SIZE_BUCKETS)[number]["id"];

export function tranchesForBucket(id: string | undefined): string[] {
  return SIZE_BUCKETS.find((bucket) => bucket.id === id)?.tranches.slice() ?? [];
}

export function effectifLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const label = EFFECTIF_LABELS[code];
  return label && code !== "NN" ? label : null;
}

/** Borne basse d'effectif déduite du code de tranche — sert d'hypothèse chiffrée. */
export function effectifFloor(code: string | null | undefined): number | null {
  const floors: Record<string, number> = {
    "00": 0, "01": 1, "02": 3, "03": 6, "11": 10, "12": 20, "21": 50,
    "22": 100, "31": 200, "32": 250, "41": 500, "42": 1000, "51": 2000,
    "52": 5000, "53": 10000,
  };
  return code && code in floors ? floors[code] : null;
}
