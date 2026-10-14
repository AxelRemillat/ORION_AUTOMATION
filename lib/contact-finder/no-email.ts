import { offTargetReason } from "@/lib/funnel/off-target";
import { isExcludedDomain, isFreeMailbox, isServiceProvider, toDomain } from "./domains";

/**
 * FICHES SANS E-MAIL (Cowork #53, relais d'agent4 #27) : une recherche Hunter
 * (Email Finder dirigeant, puis Domain Search, via lib/contact-finder) n'est
 * tentée que si elle peut servir. Pure.
 */

export interface NoEmailProspect {
  email: string | null;
  website: string | null;
  status?: string | null;
  do_not_contact?: boolean | null;
  deleted_at?: string | null;
  size_range?: string | null;
  key_figures: Record<string, unknown> | null;
  contact_search?: { hunter?: { call: string; result: string }[] } | null;
  contact_checked_at?: string | null;
}

export const NO_EMAIL_RETRY_MS = 90 * 86_400_000;

/** Motif pour lequel la fiche sans e-mail ne vaut PAS un crédit, ou `null`. */
export function noEmailIneligibility(prospect: NoEmailProspect, now = new Date()): string | null {
  const figures = prospect.key_figures ?? {};
  if (prospect.email) return "adresse déjà connue";
  if (prospect.deleted_at) return "fiche à la corbeille";
  if (prospect.do_not_contact) return "« ne plus contacter »";
  if (figures.refuses_prospecting === true) return "entreprise opposée à la prospection";
  if (prospect.status === "perdu" || prospect.status === "gagne") return `fiche ${prospect.status === "perdu" ? "perdue" : "gagnée"}`;
  const offTarget = offTargetReason({ key_figures: figures as never, size_range: prospect.size_range ?? null } as never);
  if (offTarget) return `hors cible : ${offTarget}`;
  const domain = toDomain(prospect.website);
  if (!domain) return "pas de site";
  if (isExcludedDomain(domain) || isServiceProvider(domain) || isFreeMailbox(domain)) return "pas un vrai domaine d'entreprise";
  // Hunter a déjà répondu « 0 adresse » sur ce domaine récemment : un nouveau crédit serait perdu.
  const unknown = (prospect.contact_search?.hunter ?? []).some((call) => call.call === "domain-search" && /^0 adresse/.test(call.result));
  if (unknown && prospect.contact_checked_at && now.getTime() - Date.parse(prospect.contact_checked_at) < NO_EMAIL_RETRY_MS) return "domaine inconnu de Hunter (cherché il y a moins de 90 jours)";
  return null;
}
