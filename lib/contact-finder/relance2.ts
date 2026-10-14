import type { Db } from "@/lib/trash/scope";
import { recordProspectEvent } from "@/lib/history/record";
import { usagePerson } from "@/lib/emails/salutation";
import { domainOfEmail, toDomain } from "./domains";
import { classifyEmail } from "./extract";
import { findNominativeContact, type NominativeContact } from "./nominative";
import { firstGiven, ineligibility, NOMINATIVE_RETRY_MS, type UpgradeDeps, type UpgradeProspect } from "./upgrade";

/**
 * RELANCE 2 VERS UNE PERSONNE (Cowork #52). ARTFLEX : info@ a dû transférer à
 * jp.romeo@. Quand l'intro ET la relance 1 sont parties sur une adresse
 * générique, sans réponse, on PROPOSE un contact nominatif pour la relance 2 :
 * `key_figures.relance2_contact`, affiché sur la fiche et lu par l'agent
 * rédactionnel. L'adresse principale, les relances programmées et l'envoi ne
 * changent pas ici.
 */

export interface SentRow { type: string; status: string; sent_to: string | null; deleted_at?: string | null }

export interface Relance2Contact {
  email: string;
  name: string | null;
  role: string;
  source: string;
  confidence: number;
  verifier: string;
  found_at: string;
  instead_of: string | null;
}

const isGeneric = (email: string | null | undefined) => Boolean(email) && classifyEmail(email as string) === "generique";

/** Motif pour lequel la fiche n'a PAS besoin d'une proposition, ou `null`. Pure. */
export function relance2Ineligibility(prospect: UpgradeProspect, sent: SentRow[], now = new Date()): string | null {
  // Mêmes exclusions que le nominatif (corbeille, « ne plus contacter », opposée, perdue, hors cible, déjà
  // cherché sans résultat il y a moins de 90 jours : ce serait un crédit perdu), sauf « adresse déjà
  // nominative », qui se juge ici sur les envois réels.
  const common = ineligibility({ ...prospect, email: prospect.email ?? "x@x.fr", email_type: "generique", contact_found_by: prospect.contact_found_by ?? "orion" }, now);
  if (common) return common;
  if (prospect.status !== "relance_1") return "intro et relance 1 pas encore parties, ou réponse reçue";
  const done = sent.filter((row) => row.status === "sent" && !row.deleted_at);
  const intro = done.find((row) => row.type === "intro");
  const r1 = done.find((row) => row.type === "relance_1");
  if (!intro || !r1) return "intro ou relance 1 non partie";
  if (done.some((row) => row.type === "relance_2")) return "relance 2 déjà partie";
  if (!isGeneric(intro.sent_to) || !isGeneric(r1.sent_to)) return "envoyé à une personne";
  const previous = prospect.key_figures?.relance2_contact as { found_at?: string } | undefined;
  const tried = prospect.key_figures?.relance2_checked_at as string | undefined;
  if (previous?.found_at) return "contact déjà proposé";
  if (tried && now.getTime() - Date.parse(tried) < NOMINATIVE_RETRY_MS) return "déjà cherché il y a moins de 90 jours";
  return null;
}

/**
 * Recherche NOMINATIVE sur un domaine (dirigeant du registre, noms du site, puis
 * Hunter : Domain Search, Email Finder, vérification) — score ≥ 80 et vérifiée
 * seulement (lib/contact-finder/nominative.ts). Partagée : relance 2, fiches sans e-mail.
 */
export async function searchNominative(db: Db, prospect: UpgradeProspect, domain: string, deps: UpgradeDeps) {
  const figures = prospect.key_figures ?? {};
  const usage = usagePerson(typeof figures.leader_person === "string" ? figures.leader_person : null);
  const leader = usage?.first && usage.last ? { firstName: firstGiven(usage.first), lastName: usage.last } : null;
  const { data: dnc } = await db.from("prospects").select("email").eq("user_id", prospect.user_id).eq("do_not_contact", true);
  const blocked = ((dnc ?? []) as { email: string | null }[]).map((row) => row.email).filter((email): email is string => Boolean(email));
  const pain = prospect.brief?.pain?.task ?? prospect.pain_point ?? null;
  const headcount = typeof figures.headcount === "number" ? figures.headcount : null;
  const sitePeople = deps.sitePeople ? await deps.sitePeople(domain).catch(() => []) : [];
  return findNominativeContact({ domain, pain, headcount, leader, blocked, sitePeople }, deps);
}

/**
 * Fiche SANS e-mail (Cowork #55) : seule une adresse NOMINATIVE vérifiée (≥ 80)
 * est gardée — jamais une générique. Rien d'autre ne change sur la fiche.
 */
export async function fillNoEmailNominative(
  db: Db,
  prospect: UpgradeProspect,
  deps: UpgradeDeps,
  options: { now?: Date } = {},
): Promise<{ status: "found" | "none" | "skipped"; reason: string; contact: NominativeContact | null; calls: { domainSearch: number; finder: number; verifier: number } }> {
  const now = options.now ?? new Date();
  const none = { domainSearch: 0, finder: 0, verifier: 0 };
  const domain = toDomain(prospect.website);
  if (prospect.email) return { status: "skipped", reason: "adresse déjà connue", contact: null, calls: none };
  if (!domain) return { status: "skipped", reason: "pas de site", contact: null, calls: none };
  const outcome = await searchNominative(db, prospect, domain, deps);
  const figures = prospect.key_figures ?? {};
  const trace = { checked_at: now.toISOString(), domain, steps: outcome.steps, found: outcome.contact?.email ?? null, mode: "sans e-mail" };
  if (!outcome.contact) {
    await db.from("prospects").update({ key_figures: { ...figures, nominative: { ...trace, version: 4 } } } as never).eq("id", prospect.id).eq("user_id", prospect.user_id);
    return { status: "none", reason: "aucune adresse nominative vérifiée ≥ 80", contact: null, calls: outcome.calls };
  }
  const c = outcome.contact;
  await db
    .from("prospects")
    .update({
      email: c.email,
      email_type: "nominatif",
      contact_name: c.name,
      contact_role: c.role,
      contact_source: c.source,
      contact_confidence: c.confidence,
      contact_found_by: `${c.source}+verifier:${c.verifier}`,
      key_figures: { ...figures, nominative: { ...trace, version: 4 } },
    } as never)
    .eq("id", prospect.id)
    .eq("user_id", prospect.user_id);
  await recordProspectEvent(db, { prospectId: prospect.id, userId: prospect.user_id, kind: "contact", at: now.toISOString(), data: { title: `Contact nominatif trouvé (fiche sans e-mail) : ${[c.name, c.role].filter(Boolean).join(" — ")} <${c.email}>` } });
  return { status: "found", reason: `${c.email} (${c.verifier}, ${c.confidence})`, contact: c, calls: outcome.calls };
}

export async function proposeRelance2Contact(
  db: Db,
  prospect: UpgradeProspect,
  sent: SentRow[],
  deps: UpgradeDeps,
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<{ status: "proposed" | "none" | "skipped"; reason: string; contact: NominativeContact | null; calls: { domainSearch: number; finder: number; verifier: number } }> {
  const now = options.now ?? new Date();
  const none = { domainSearch: 0, finder: 0, verifier: 0 };
  const refused = relance2Ineligibility(prospect, sent, now);
  if (refused) return { status: "skipped", reason: refused, contact: null, calls: none };
  const domain = domainOfEmail(prospect.email) ?? toDomain(prospect.website);
  if (!domain) return { status: "skipped", reason: "aucun domaine", contact: null, calls: none };

  const figures = prospect.key_figures ?? {};
  const outcome = await searchNominative(db, prospect, domain, deps);
  if (options.dryRun) return { status: outcome.contact ? "proposed" : "none", reason: "simulation", contact: outcome.contact, calls: outcome.calls };

  if (!outcome.contact) {
    await db.from("prospects").update({ key_figures: { ...figures, relance2_checked_at: now.toISOString() } } as never).eq("id", prospect.id).eq("user_id", prospect.user_id);
    return { status: "none", reason: "aucune adresse nominative sûre", contact: null, calls: outcome.calls };
  }
  const c = outcome.contact;
  const proposal: Relance2Contact = { email: c.email, name: c.name, role: c.role, source: c.source, confidence: c.confidence, verifier: c.verifier, found_at: now.toISOString(), instead_of: prospect.email };
  await db.from("prospects").update({ key_figures: { ...figures, relance2_contact: proposal, relance2_checked_at: now.toISOString() } } as never).eq("id", prospect.id).eq("user_id", prospect.user_id);
  await recordProspectEvent(db, {
    prospectId: prospect.id,
    userId: prospect.user_id,
    kind: "contact",
    at: now.toISOString(),
    data: { title: `Contact proposé pour la relance 2 : ${[c.name, c.role].filter(Boolean).join(" — ")} <${c.email}> (au lieu de ${prospect.email})` },
  });
  return { status: "proposed", reason: `${c.email} (${c.verifier}, ${c.confidence})`, contact: c, calls: outcome.calls };
}
