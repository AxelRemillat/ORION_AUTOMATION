import { fetchInpiOpposition } from "./inpi";
import { fetchPappers, hasPappersKey } from "./pappers";

/**
 * Opposition à la prospection d'un SIREN, par Pappers (un crédit) et par l'API
 * RNE de l'INPI (gratuite).
 *
 *   - `pappers-first` (défaut) : revérification d'une fiche creusée « non
 *     vérifiée » — Pappers tant qu'il répond, l'INPI sinon ;
 *   - `inpi-first` : rattrapage de masse des fiches de « Aujourd'hui » dont
 *     l'opposition n'a jamais été lue — l'INPI suffit et ne coûte rien.
 */
export type OppositionCheck =
  | { ok: true; refuses: boolean; source: "pappers" | "inpi" }
  | { ok: false; error: string };

/** `inpi-only` : gratuit, sans repli Pappers — l'étape « sites », avant toute dépense. */
export type OppositionOrder = "pappers-first" | "inpi-first" | "inpi-only";

async function viaPappers(siren: string): Promise<OppositionCheck | null> {
  if (!hasPappersKey()) return null;
  const pappers = await fetchPappers(siren, { force: true });
  return pappers.ok ? { ok: true, refuses: pappers.data.refuses_prospecting, source: "pappers" } : null;
}

async function viaInpi(siren: string): Promise<OppositionCheck> {
  const inpi = await fetchInpiOpposition(siren);
  return inpi.ok ? { ok: true, refuses: inpi.refuses, source: "inpi" } : { ok: false, error: inpi.error };
}

// INPI d'abord partout (sobriété Pappers, 05/10/2026) : Pappers n'est plus qu'un repli.
export async function verifyOpposition(siren: string, order: OppositionOrder = "inpi-first"): Promise<OppositionCheck> {
  if (order === "inpi-only") return viaInpi(siren);
  if (order === "inpi-first") {
    const inpi = await viaInpi(siren);
    return inpi.ok ? inpi : ((await viaPappers(siren)) ?? inpi);
  }
  return (await viaPappers(siren)) ?? viaInpi(siren);
}
