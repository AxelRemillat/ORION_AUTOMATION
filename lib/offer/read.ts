import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserOffer } from "@/types";
import { OFFER_DEFAULTS, isOfferComplete, withDefaults } from "./model";

/**
 * Lecture de l'offre du compte courant.
 *
 * Deux exigences qui se contredisent en apparence : la génération ne doit
 * jamais échouer parce que la page /offre n'a pas été remplie, et l'UI doit
 * pouvoir dire qu'elle ne l'est pas. On rend donc toujours une offre
 * exploitable — complétée par les valeurs par défaut — plus un drapeau
 * `complete` qui dit la vérité.
 */
export interface LoadedOffer {
  offer: UserOffer;
  /** `false` quand la ligne n'existe pas ou qu'il manque l'essentiel. */
  complete: boolean;
  /** `true` quand rien n'est encore enregistré en base. */
  empty: boolean;
}

export async function loadOffer(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<LoadedOffer> {
  const { data } = await supabase
    .from("user_offer")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    // Aucune ligne : on travaille sur les valeurs par défaut, et on le signale.
    return { offer: withDefaults(null, userId), complete: false, empty: true };
  }

  const offer = withDefaults(data, userId);
  return { offer, complete: isOfferComplete(offer), empty: false };
}

/** Offre par défaut, pour un script ou un test qui n'a pas de base. */
export function defaultOffer(userId = "local"): UserOffer {
  return { ...OFFER_DEFAULTS, user_id: userId, created_at: "", updated_at: "" };
}
