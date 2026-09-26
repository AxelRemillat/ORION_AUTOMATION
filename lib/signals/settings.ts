import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import { DEFAULT_EXCLUDED_SECTORS, normalizeNaf } from "./targeting";

/**
 * Réglages de recherche : lecture et écriture.
 *
 * Règle qui gouverne tout ce fichier : **un réglage illisible ne casse jamais
 * une recherche**. Si la table n'est pas encore migrée, ou si la requête
 * échoue, on rend les valeurs par défaut et la recherche continue. Le pire
 * scénario est alors une entreprise proposée qu'Axel aurait exclue — ennuyeux,
 * pas bloquant. L'inverse (une recherche qui refuse de partir parce qu'un
 * réglage manque) serait bien plus coûteux.
 */

type Client = SupabaseClient<Database>;

/** Nombre de préfixes acceptés. Au-delà, c'est une liste qu'on ne relit plus. */
export const MAX_EXCLUDED_SECTORS = 60;

/**
 * Nettoie une liste saisie à la main.
 *
 * Les doublons et la casse sont absorbés, les entrées vides écartées. Une
 * entrée conserve sa forme normalisée (`8553Z`) : c'est elle qui sera comparée
 * par préfixe, et garder « 85.53 z » aurait fait échouer la comparaison en
 * silence.
 */
export function cleanSectors(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const code = normalizeNaf(value);
    // Une division NAF fait deux chiffres : en dessous, le préfixe écarterait
    // des pans entiers de l'économie sur une faute de frappe.
    if (code.length < 2) continue;
    seen.add(code);
    if (seen.size >= MAX_EXCLUDED_SECTORS) break;
  }
  return [...seen];
}

/**
 * Secteurs exclus de cet utilisateur.
 *
 * La ligne est créée à la première lecture, avec les valeurs par défaut : ainsi
 * l'écran a toujours quelque chose à afficher et à modifier, sans avoir à
 * distinguer « jamais réglé » de « réglé à vide ».
 */
export async function readExcludedSectors(supabase: Client): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("search_settings")
      .select("excluded_sectors")
      .maybeSingle();

    if (data) return cleanSectors(data.excluded_sectors ?? []);

    // Première visite : on pose les valeurs de départ. Un échec ici (table
    // absente, course entre deux onglets) n'empêche rien.
    const defaults = [...DEFAULT_EXCLUDED_SECTORS];
    await supabase
      .from("search_settings")
      .upsert({ excluded_sectors: defaults }, { onConflict: "user_id" });
    return defaults;
  } catch {
    return [...DEFAULT_EXCLUDED_SECTORS];
  }
}

/** Remplace la liste. Rend la liste effectivement enregistrée. */
export async function writeExcludedSectors(
  supabase: Client,
  values: readonly unknown[],
): Promise<{ sectors: string[] } | { error: string }> {
  const sectors = cleanSectors(values);
  const { error } = await supabase
    .from("search_settings")
    .upsert({ excluded_sectors: sectors }, { onConflict: "user_id" });

  if (error) return { error: error.message };
  return { sectors };
}
