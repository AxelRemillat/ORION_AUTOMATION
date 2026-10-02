import { fetchInpiOpposition } from "./inpi";
import { fetchPappers, hasPappersKey } from "./pappers";

/**
 * Opposition à la prospection d'un SIREN : Pappers tant qu'il répond (un
 * crédit), sinon l'API RNE de l'INPI (gratuite). Sert à revérifier, au run
 * suivant, une fiche publiée « opposition non vérifiée ».
 */
export type OppositionCheck =
  | { ok: true; refuses: boolean; source: "pappers" | "inpi" }
  | { ok: false; error: string };

export async function verifyOpposition(siren: string): Promise<OppositionCheck> {
  if (hasPappersKey()) {
    const pappers = await fetchPappers(siren);
    if (pappers.ok) return { ok: true, refuses: pappers.data.refuses_prospecting, source: "pappers" };
  }
  const inpi = await fetchInpiOpposition(siren);
  return inpi.ok ? { ok: true, refuses: inpi.refuses, source: "inpi" } : { ok: false, error: inpi.error };
}
