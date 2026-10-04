import type { SupabaseClient } from "@supabase/supabase-js";
import { realDeps } from "@/lib/contact-finder/clients";
import { resolveSite, siteIdentity } from "@/lib/contact-finder/free-site";
import { hasMx } from "@/lib/contact-finder/mx";
import { liveDigDeps } from "@/lib/funnel/live";
import { ensureBusinessProfile, profileAsk } from "@/lib/jobs/business-profile";
import type { Database, Prospect, SignalCandidateRow } from "@/types";
import type { CompletionDeps } from "./complete";

/**
 * Branchements RÉELS de la complétion automatique (lib/today/complete.ts).
 * Partagés par la préparation du matin, le bouton « Compléter avec ORION » et
 * le script de relance : une seule chaîne, un seul comportement.
 */

type Db = SupabaseClient<Database>;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

async function prospectOf(db: Db, id: string): Promise<Prospect | null> {
  const { data } = await db.from("prospects").select("*").eq("id", id).maybeSingle();
  return (data as Prospect | null) ?? null;
}

export function liveCompletionDeps(db: Db, userId: string, runId: string): CompletionDeps {
  const dig = liveDigDeps(db, userId, runId);
  return {
    findContact: dig.findContact,
    hunterBlocked: dig.hunterBlocked,
    hasMx,
    async resolveSite(row: SignalCandidateRow) {
      const prospect = await prospectOf(db, row.prospect_id as string);
      if (!prospect) return null;
      if (prospect.website) return { website: prospect.website, found: false };
      const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
      const facts = (row.facts ?? {}) as { employerUrl?: string | null };
      const contact = (row.contact ?? {}) as { site_free?: { website?: string | null } };
      const { site } = await resolveSite(
        siteIdentity({
          id: prospect.id,
          name: prospect.company_name,
          tradeNames: [text(figures.commercial_name), text(figures.enseigne)],
          siren: prospect.siren,
          city: prospect.city,
        }),
        realDeps(prospect.id),
        {
          knownUrls: [contact.site_free?.website, facts.employerUrl, prospect.email ? `https://${prospect.email.split("@")[1]}` : null],
          score: (row.triage as { score?: number } | null)?.score ?? row.score,
        },
      );
      if (!site) return null;
      // Le site trouvé est écrit sur la fiche, seulement s'il manquait.
      await db.from("prospects").update({ website: site.website }).eq("id", prospect.id).is("website", null);
      return { website: site.website, found: true };
    },
    async readProfile(prospectId: string) {
      const prospect = await prospectOf(db, prospectId);
      if (prospect) await ensureBusinessProfile(db, prospect, profileAsk(prospect.id));
    },
    async markUnreachable(prospectId: string, reason: string) {
      const prospect = await prospectOf(db, prospectId);
      if (!prospect) return;
      await db
        .from("prospects")
        .update({ key_figures: { ...(prospect.key_figures ?? {}), unreachable: { reason, at: new Date().toISOString() } } })
        .eq("id", prospectId);
    },
  };
}
