import { chatJson } from "@/lib/ai/chat";
import { getOpenAI } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { coverSite } from "@/lib/enrichment/site";
import {
  extractProfile,
  profileIsFresh,
  storedProfile,
  type BusinessProfile,
  type ProfileAsk,
} from "@/lib/emails/business-profile";
import type { Db } from "@/lib/trash/scope";
import type { Prospect } from "@/types";

/** Pages d'offres d'emploi : elles ne décrivent pas le métier, elles coûtent du contexte. */
const JOB_PAGE = /offre|emploi|recrut|carri|jobs?\b|rejoindre/i;

export interface ProfileRun {
  profile: BusinessProfile | null;
  /** `true` quand le site a été relu à cette occasion. */
  refreshed: boolean;
  note: string | null;
}

/**
 * Profil métier d'un prospect : relu du cache s'il a moins de 30 jours, sinon
 * lu sur le site (accueil, à propos, services — lecture directe gratuite,
 * Linkup en repli) puis enregistré sur la fiche.
 *
 * Sans site, pas de profil : le stratège est prévenu, il ne devine pas.
 * Une lecture ratée n'efface jamais un profil déjà connu.
 */
export async function ensureBusinessProfile(
  db: Db,
  prospect: Prospect,
  ask: ProfileAsk,
  /** `persist: false` : lecture en mémoire seulement (itérations qualité, rien en base). */
  options: { force?: boolean; now?: Date; persist?: boolean } = {},
): Promise<ProfileRun> {
  const known = storedProfile(prospect.business_profile);
  if (known && !options.force && profileIsFresh(prospect.business_profile_at, options.now)) {
    return { profile: known, refreshed: false, note: null };
  }
  if (!prospect.website) return { profile: known, refreshed: false, note: "pas de site connu : profil métier non lu" };

  // Un échec ponctuel (page lente, extraction ratée) est retenté UNE fois
  // (décision Cowork, itération 2 : AGCEI lu une fois sur deux).
  for (let attempt = 0; attempt < 2; attempt += 1) {
  const coverage = await coverSite(
    {
      name: prospect.company_name,
      siren: prospect.siren,
      city: prospect.city,
      knownWebsite: prospect.website,
    },
    { prospectId: prospect.id, allowLinkupSearch: false, trustKnownWebsite: true },
  );
  const pages = coverage.pages
    .filter((page) => !JOB_PAGE.test(new URL(page.url).pathname))
    .slice(0, 4)
    .map((page) => ({ url: page.url, text: page.text }));
  if (!pages.length) {
    if (attempt === 0) continue;
    return { profile: known, refreshed: false, note: coverage.note ?? "site illisible" };
  }

  const profile = await extractProfile(ask, prospect.company_name, pages);
  if (!profile) {
    if (attempt === 0) continue;
    return { profile: known, refreshed: false, note: "profil métier inexploitable" };
  }

  const at = (options.now ?? new Date()).toISOString();
  if (options.persist !== false) await db
    .from("prospects")
    .update({ business_profile: profile as unknown as Record<string, unknown>, business_profile_at: at })
    .eq("id", prospect.id);
  prospect.business_profile = profile as unknown as Record<string, unknown>;
  prospect.business_profile_at = at;
  return { profile, refreshed: true, note: null };
  }
  return { profile: known, refreshed: false, note: "site illisible" };
}

/** Appel du rôle « profile » (gpt-6-luna par défaut), coût imputé au prospect. */
export function profileAsk(prospectId: string): ProfileAsk {
  return (system, user, operation) =>
    chatJson({
      client: getOpenAI(),
      role: "profile",
      system,
      user,
      temperature: 0,
      operation,
      onUsage: (usage) =>
        recordOpenAiUsage({
          model: usage.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          operation: usage.operation,
          prospectId,
        }),
    });
}
