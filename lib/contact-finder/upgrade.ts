import { recordProspectEvent } from "@/lib/history/record";
import type { Db } from "@/lib/trash/scope";
import { domainOfEmail, toDomain } from "./domains";
import { classifyEmail } from "./extract";
import { usageName } from "./names";
import { findNominativeContact, type NominativeContact, type NominativeDeps, type RoleKey } from "./nominative";

/**
 * Passage d'une adresse GÉNÉRIQUE à une adresse NOMINATIVE (Hunter), pour une
 * fiche donnée. Utilisé par la complétion (nouvelles fiches) et par le
 * rattrapage (scripts/nominative-backfill.ts).
 *
 * Ne touche JAMAIS :
 *   - une fiche opposée (INPI/Pappers), à l'opposition non vérifiée, « ne plus
 *     contacter », non joignable, à la corbeille ;
 *   - une adresse saisie à la main ;
 *   - une fiche déjà contactée (un mail parti) ou dont un brouillon est validé,
 *     programmé ou modifié à la main : le mail en cours garde son destinataire.
 * Une adresse d'une fiche « ne plus contacter » n'est jamais retenue.
 *
 * Quand une adresse nominative est trouvée, les brouillons d'intro encore
 * libres sont marqués « à régénérer » (`messages.regenerate_reason`) — la
 * régénération elle-même appartient au générateur de mails.
 */

export interface UpgradeProspect {
  id: string;
  user_id: string;
  company_name: string;
  email: string | null;
  email_type: string | null;
  website: string | null;
  contact_found_by: string | null;
  contact_name?: string | null;
  do_not_contact?: boolean | null;
  deleted_at?: string | null;
  pain_point?: string | null;
  brief?: { pain?: { task?: string | null } | null } | null;
  key_figures: Record<string, unknown> | null;
}

export type UpgradeStatus = "upgraded" | "kept" | "skipped";

export interface UpgradeResult {
  status: UpgradeStatus;
  reason: string;
  contact: NominativeContact | null;
  targets: RoleKey[];
  calls: { domainSearch: number; finder: number; verifier: number };
  /** Brouillons marqués « à régénérer ». */
  flagged: number;
}

/** Une nouvelle recherche n'est pas relancée avant 90 jours (le cache Hunter dure autant). */
export const NOMINATIVE_RETRY_MS = 90 * 86_400_000;

const NO_CALLS = () => ({ domainSearch: 0, finder: 0, verifier: 0 });
const skip = (reason: string): UpgradeResult => ({ status: "skipped", reason, contact: null, targets: [], calls: NO_CALLS(), flagged: 0 });

/** L'adresse actuelle est-elle générique ? (classement de la fiche, sinon de la partie locale) */
export function isGenericAddress(prospect: Pick<UpgradeProspect, "email" | "email_type">): boolean {
  if (!prospect.email) return false;
  if (prospect.email_type === "generique") return true;
  if (prospect.email_type === "nominatif") return false;
  return classifyEmail(prospect.email) === "generique";
}

/** Motif pour lequel la fiche n'est PAS éligible, ou `null`. Pure. */
export function ineligibility(prospect: UpgradeProspect, now = new Date()): string | null {
  const figures = prospect.key_figures ?? {};
  if (prospect.deleted_at) return "fiche à la corbeille";
  if (prospect.do_not_contact) return "« ne plus contacter »";
  if (figures.refuses_prospecting === true) return "entreprise opposée à la prospection";
  if (figures.opposition_checked !== true) return "opposition non vérifiée";
  if (figures.unreachable) return "fiche non joignable";
  if (!prospect.email) return "pas d'adresse";
  if (!isGenericAddress(prospect)) return "adresse déjà nominative";
  // Adresse saisie à la main : ni trouvée par ORION, ni classée par lui.
  if (!prospect.contact_found_by && !prospect.email_type) return "adresse saisie à la main";
  const last = (figures.nominative as { checked_at?: string } | undefined)?.checked_at;
  if (last && now.getTime() - Date.parse(last) < NOMINATIVE_RETRY_MS) return "déjà cherché il y a moins de 90 jours";
  return null;
}

interface DraftRow {
  id: string;
  type: string;
  status: string;
  send_status: string | null;
  validated_at: string | null;
  edited_by_hand: boolean | null;
  scheduled_at: string | null;
  deleted_at: string | null;
}

/** Un brouillon encore libre : ni parti, ni validé, ni programmé, ni retouché à la main. */
export function isFreeDraft(row: DraftRow): boolean {
  return (
    row.status === "draft" &&
    !row.deleted_at &&
    !row.validated_at &&
    !row.edited_by_hand &&
    !row.scheduled_at &&
    !["scheduled", "sending", "sent"].includes(row.send_status ?? "draft")
  );
}

export async function upgradeToNominative(
  db: Db,
  prospect: UpgradeProspect,
  deps: NominativeDeps,
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<UpgradeResult> {
  const now = options.now ?? new Date();
  const refused = ineligibility(prospect, now);
  if (refused) return skip(refused);

  // Le mail en cours garde son destinataire : fiche déjà contactée, ou brouillon verrouillé.
  const { data: rows } = await db
    .from("messages")
    .select("id, type, status, send_status, validated_at, edited_by_hand, scheduled_at, deleted_at")
    .eq("prospect_id", prospect.id)
    .eq("user_id", prospect.user_id);
  const messages = ((rows ?? []) as DraftRow[]).filter((row) => !row.deleted_at && row.type !== "note");
  if (messages.some((row) => row.status === "sent")) return skip("déjà contactée");
  if (messages.some((row) => !isFreeDraft(row))) return skip("brouillon validé, programmé ou modifié à la main");

  const domain = domainOfEmail(prospect.email) ?? toDomain(prospect.website);
  if (!domain) return skip("aucun domaine");

  const figures = prospect.key_figures ?? {};
  const leader = usageName(typeof figures.leader_person === "string" ? figures.leader_person : null);
  const { data: dnc } = await db.from("prospects").select("email").eq("user_id", prospect.user_id).eq("do_not_contact", true);
  const blocked = ((dnc ?? []) as { email: string | null }[]).map((row) => row.email).filter((email): email is string => Boolean(email));

  const outcome = await findNominativeContact(
    {
      domain,
      pain: prospect.brief?.pain?.task ?? prospect.pain_point ?? null,
      headcount: typeof figures.headcount === "number" ? figures.headcount : null,
      leader: leader ? { firstName: leader.firstName, lastName: leader.lastName } : null,
      blocked,
    },
    deps,
  );
  const base = { contact: outcome.contact, targets: outcome.targets, calls: outcome.calls };
  if (options.dryRun) return { ...base, status: outcome.contact ? "upgraded" : "kept", reason: "simulation", flagged: 0 };

  const trace = { checked_at: now.toISOString(), domain, from: prospect.email, targets: outcome.targets, steps: outcome.steps, found: outcome.contact?.email ?? null };
  if (!outcome.contact) {
    await db.from("prospects").update({ key_figures: { ...figures, nominative: trace } } as never).eq("id", prospect.id);
    return { ...base, status: "kept", reason: "aucune adresse nominative sûre", flagged: 0 };
  }

  const contact = outcome.contact;
  const { error } = await db
    .from("prospects")
    .update({
      email: contact.email,
      email_type: "nominatif",
      contact_name: contact.name,
      contact_role: contact.role,
      contact_source: contact.source,
      contact_confidence: contact.confidence,
      contact_found_by: `${contact.source}+verifier:${contact.verifier}`,
      key_figures: { ...figures, nominative: trace, email_doubtful: false },
    } as never)
    .eq("id", prospect.id)
    .eq("user_id", prospect.user_id);
  if (error) return { ...base, status: "kept", reason: `fiche non mise à jour : ${error.message}`, flagged: 0 };

  // Brouillons libres : à régénérer pour la personne réellement contactée.
  const reason = `Contact nominatif : ${[contact.name, contact.role].filter(Boolean).join(" — ")} <${contact.email}> (au lieu de ${prospect.email}).`;
  let flagged = 0;
  for (const row of messages.filter(isFreeDraft)) {
    const { data: updated } = await db
      .from("messages")
      .update({ regenerate_reason: reason, regenerate_requested_at: now.toISOString() } as never)
      .eq("id", row.id)
      .eq("status", "draft")
      .is("validated_at", null)
      .eq("edited_by_hand", false)
      .select("id");
    flagged += updated?.length ?? 0;
  }

  await recordProspectEvent(db, {
    prospectId: prospect.id,
    userId: prospect.user_id,
    kind: "contact",
    channel: "orion",
    at: now.toISOString(),
    data: { title: "Contact nominatif trouvé", detail: reason },
  });
  return { ...base, status: "upgraded", reason, flagged };
}

/** Part d'adresses nominatives dans un lot de fiches (stock du rapport). */
export function nominativeShare(prospects: Pick<UpgradeProspect, "email" | "email_type">[]): { nominative: number; total: number } {
  const withEmail = prospects.filter((prospect) => prospect.email);
  return { nominative: withEmail.filter((prospect) => !isGenericAddress(prospect)).length, total: withEmail.length };
}
