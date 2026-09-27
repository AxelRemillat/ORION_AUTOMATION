import { createAdminClient } from "@/lib/supabase/server";
import { findDecisionMaker, hasHunterKey } from "@/lib/enrichment/hunter";
import { toDomain } from "@/lib/enrichment/http";

/**
 * Module contact — CONTRAT PARTAGÉ entre sessions.
 *
 *   findContact(prospectId) → ContactResult
 *
 * STUB (Hunter seul) posé par la session « entonnoir signaux » tant que la
 * vraie implémentation (session « contact ») n'est pas sur main. En cas de
 * conflit au rebase, c'est la vraie implémentation qui gagne : la signature
 * ci-dessous ne doit pas bouger.
 */
export type ContactResult = {
  website?: string;
  email?: string;
  email_type?: "nominatif" | "generique";
  email_source_url?: string;
  confidence: number;
  found_by: string;
};

/** Adresse de service (contact@, info@…) : générique, pas une personne. */
const GENERIC_LOCAL = /^(contact|info|infos|hello|bonjour|accueil|commercial|sales|admin|compta|rh|jobs|recrutement|office|secretariat)\b/i;

export function emailType(email: string): "nominatif" | "generique" {
  return GENERIC_LOCAL.test(email.split("@")[0] ?? "") ? "generique" : "nominatif";
}

export async function findContact(prospectId: string): Promise<ContactResult> {
  const db = createAdminClient();
  const { data } = await db
    .from("prospects")
    .select("website, email, key_figures")
    .eq("id", prospectId)
    .maybeSingle();
  if (!data) return { confidence: 0, found_by: "aucun" };

  const website = data.website ?? undefined;
  // Une adresse déjà connue (Pappers) vaut mieux qu'une recherche payante.
  if (data.email) {
    return { website, email: data.email, email_type: emailType(data.email), confidence: 70, found_by: "fiche" };
  }

  const domain = toDomain(data.website);
  if (!domain || !hasHunterKey()) return { website, confidence: 0, found_by: "aucun" };

  const figures = (data.key_figures ?? {}) as Record<string, unknown>;
  const leader = typeof figures.leader_person === "string" ? figures.leader_person : null;
  const search = await findDecisionMaker(domain, leader, prospectId);
  if (!search.ok) return { website, confidence: 0, found_by: "hunter" };

  const best = search.data.contact ?? search.data.candidates[0] ?? null;
  if (!best) return { website, confidence: 0, found_by: "hunter" };
  return {
    website,
    email: best.email,
    email_type: emailType(best.email),
    confidence: best.confidence ?? 50,
    found_by: "hunter",
  };
}
