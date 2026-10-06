import { findEmailByName } from "@/lib/enrichment/hunter";
import { recordUnitUsage } from "@/lib/usage/record";
import { hunterStatus } from "@/lib/hunter/gate";
import { supabaseHunterStore } from "@/lib/hunter/store";
import type { Db } from "@/lib/trash/scope";
import { hunter } from "./clients";
import { upgradeToNominative, type UpgradeProspect, type UpgradeResult } from "./upgrade";
import type { HunterPerson, NominativeDeps, VerifierStatus } from "./nominative";

/**
 * Branchement RÉEL de la recherche nominative : Hunter, derrière le garde-fou
 * (cache 90 jours par requête, budget du jour `HUNTER_DAILY_BUDGET`). Chaque
 * appel facturé est tracé dans `api_usage` (opérations « nominatif:* »), donc
 * visible dans Pilotage et Réglages › Coûts.
 */

interface DomainSearchEmail {
  value?: string;
  type?: "personal" | "generic";
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  confidence?: number | null;
  department?: string | null;
  seniority?: string | null;
}

export function liveNominativeDeps(prospectId: string | null): NominativeDeps {
  return {
    async domainSearch(domain, filters) {
      const params: Record<string, string> = { domain, type: "personal", limit: "10" };
      if (filters.departments.length) params.department = filters.departments.join(",");
      const { data, billed } = await hunter<{ emails?: DomainSearchEmail[] }>("domain-search", params);
      const emails = (data?.emails ?? []).filter((email) => email.value);
      if (billed) await recordUnitUsage({ service: "hunter", operation: `nominatif:domain-search:${emails.length ? "trouve" : "vide"}`, units: 1, prospectId });
      return data
        ? emails.map<HunterPerson>((email) => ({
            email: (email.value as string).toLowerCase(),
            type: email.type ?? null,
            firstName: email.first_name ?? null,
            lastName: email.last_name ?? null,
            position: email.position ?? null,
            confidence: email.confidence ?? null,
            department: email.department ?? null,
            seniority: email.seniority ?? null,
          }))
        : null;
    },
    async emailFinder(domain, firstName, lastName) {
      // Client existant : il trace déjà son appel dans api_usage.
      const found = await findEmailByName(domain, firstName, lastName, prospectId);
      return found.ok && found.data ? { email: found.data.email.toLowerCase(), score: found.data.confidence ?? null, position: found.data.position ?? null } : null;
    },
    async verify(email) {
      const { data, billed } = await hunter<{ status?: VerifierStatus; score?: number | null }>("email-verifier", { email });
      if (billed) await recordUnitUsage({ service: "hunter", operation: `nominatif:email-verifier:${data?.status ?? "erreur"}`, units: 1, prospectId });
      return data?.status ? { status: data.status, score: data.score ?? null } : null;
    },
  };
}

/**
 * Recherche nominative d'une fiche, en réel. Hunter bloqué (budget du jour,
 * crédits) : rien n'est tenté ni noté — la fiche sera reprise plus tard.
 */
export async function upgradeProspectLive(
  db: Db,
  prospectId: string,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<UpgradeResult> {
  const status = await hunterStatus(supabaseHunterStore(), options.now);
  if (status.blocked) return { status: "skipped", reason: status.blocked, contact: null, targets: [], calls: { domainSearch: 0, finder: 0, verifier: 0 }, flagged: 0 };
  const { data } = await db.from("prospects").select("*").eq("id", prospectId).maybeSingle();
  if (!data) return { status: "skipped", reason: "fiche introuvable", contact: null, targets: [], calls: { domainSearch: 0, finder: 0, verifier: 0 }, flagged: 0 };
  return upgradeToNominative(db, data as unknown as UpgradeProspect, liveNominativeDeps(prospectId), options);
}
