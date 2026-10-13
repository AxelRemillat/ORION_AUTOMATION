/**
 * Branchements RÉELS du gabarit qualité pour les scripts locaux
 * (eval-quality, regenerate-drafts). Lit `.env.local`, n'affiche aucun secret.
 * Appels OpenAI PAYANTS : chaque appel est enregistré dans `api_usage`.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database, Prospect } from "@/types";

export function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const missing = ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE"].filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Variables manquantes : ${missing.join(", ")}. Script à lancer en local.`);
  process.exit(1);
}

export const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!, {
  auth: { persistSession: false },
});

/* Imports après le chargement de l'environnement : certains modules lisent
 * process.env au chargement (modèles, prix). */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chatJson } = require("@/lib/ai/chat") as typeof import("@/lib/ai/chat");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getOpenAI } = require("@/lib/openai") as typeof import("@/lib/openai");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { recordOpenAiUsage } = require("@/lib/usage/record") as typeof import("@/lib/usage/record");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildFacts } = require("@/lib/emails/derived-facts") as typeof import("@/lib/emails/derived-facts");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runStrategist } = require("@/lib/emails/strategist") as typeof import("@/lib/emails/strategist");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const factsGate = require("@/lib/emails/quality/facts-gate") as typeof import("@/lib/emails/quality/facts-gate");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailHandler = require("@/lib/jobs/handlers/email") as typeof import("@/lib/jobs/handlers/email");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const greeting = require("@/lib/emails/quality/greeting") as typeof import("@/lib/emails/quality/greeting");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const quality = require("@/lib/emails/quality/generate") as typeof import("@/lib/emails/quality/generate");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { storedProfile } = require("@/lib/emails/business-profile") as typeof import("@/lib/emails/business-profile");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { signatureFor } = require("@/lib/offer/model") as typeof import("@/lib/offer/model");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadOffer } = require("@/lib/offer/read") as typeof import("@/lib/offer/read");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { offerNumbers } = require("@/app/api/emails/generate/pipeline") as typeof import("@/app/api/emails/generate/pipeline");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { singleCompanyName } = require("@/lib/company-name") as typeof import("@/lib/company-name");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { incomingLeader } = require("@/lib/emails/incoming-leader") as typeof import("@/lib/emails/incoming-leader");

import type { AskFn } from "@/lib/ai/chat";
import type { StrategyBrief } from "@/lib/emails/strategist";
import type { QualityBlocked, QualityOutcome } from "@/lib/emails/quality/generate";
import type { MailFamily } from "@/lib/emails/quality/families";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const businessProfile = require("@/lib/jobs/business-profile") as typeof import("@/lib/jobs/business-profile");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const freeSite = require("@/lib/contact-finder/free-site") as typeof import("@/lib/contact-finder/free-site");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const contactClients = require("@/lib/contact-finder/clients") as typeof import("@/lib/contact-finder/clients");

export const liveAsk = (prospectId: string | null): AskFn => (role, system, user, temperature, operation) =>
  chatJson({
    client: getOpenAI(),
    role,
    system,
    user,
    temperature,
    operation,
    onUsage: (usage) =>
      recordOpenAiUsage({ model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, cachedTokens: usage.cachedTokens, operation: usage.operation, prospectId }),
  });

/** Coût OpenAI enregistré depuis `since` (€), pour le plafond des scripts. */
export async function spentSince(userId: string, since: string): Promise<number> {
  const { data } = await db.from("api_usage").select("cost").eq("user_id", userId).eq("service", "openai").gte("created_at", since);
  return (data ?? []).reduce((total, row) => total + (Number((row as { cost: number }).cost) || 0), 0);
}

export async function ownerId(): Promise<string> {
  const { data } = await db.auth.admin.listUsers();
  const id = data.users[0]?.id;
  if (!id) throw new Error("aucun utilisateur");
  // Les appels du script sont imputés à ce compte (lib/usage/record.ts).
  process.env.ORION_SCRIPT_USER_ID = id;
  return id;
}

const isBrief = (value: unknown): value is StrategyBrief =>
  Boolean(value && typeof value === "object" && (value as StrategyBrief).angle && (value as StrategyBrief).pain && (value as StrategyBrief).companyName);

export interface PreparedMail {
  outcome: QualityOutcome | QualityBlocked | { error: string };
  /** Note sur la lecture du site faite pour l'occasion (en mémoire). */
  profileNote?: string | null;
  /** Site trouvé par la recherche gratuite pour l'occasion. */
  foundSite?: string | null;
  brief?: StrategyBrief;
  civilities: Record<string, "M" | "F" | "?">;
  greeting: string;
}

/**
 * Le vrai chemin du job (`draftStep`), sans écriture : brief stocké (sinon le
 * stratège), faits, civilité (prénom inconnu → modèle léger), gabarit qualité.
 */
export async function prepareMail(
  prospect: Prospect,
  userId: string,
  options: { usedCliches?: readonly string[]; readSite?: boolean; persist?: boolean; dayOpenings?: { total: number; avec: number }; family?: MailFamily; ask?: AskFn } = {},
): Promise<PreparedMail> {
  // Même garde-fou que le job de production : « ne plus contacter », opposé, perdu, hors cible → aucun mail,
  // y compris dans une mesure ou un jeu d'étalonnage (Cowork #36).
  const blocker = emailHandler.emailBlocker(prospect);
  if (blocker && blocker.status === 409) return { outcome: { error: blocker.message }, civilities: {}, greeting: "" };
  const ask = options.ask ?? liveAsk(prospect.id);
  // Comme le job : site inconnu → recherche GRATUITE (domaines du nom, validés
  // par les mentions légales). Écrit seulement si `persist` (régénération).
  let foundSite: string | null = null;
  if (options.readSite && !prospect.website) {
    const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
    const found = await freeSite
      .findSiteFree(
        freeSite.siteIdentity({ id: prospect.id, name: prospect.company_name, tradeNames: [figures.commercial_name as string | null], siren: prospect.siren, city: prospect.city }),
        contactClients.realDeps(prospect.id),
      )
      .catch(() => null);
    if (found) {
      foundSite = found.website;
      prospect.website = found.website;
      if (options.persist) await db.from("prospects").update({ website: found.website }).eq("id", prospect.id).is("website", null);
    }
  }
  // Comme le job : site connu, profil vide → lecture du site. Ici EN MÉMOIRE
  // (`persist: false`) : rien n'est écrit en base.
  let profileNote: string | null = null;
  if (options.readSite && prospect.website && !storedProfile(prospect.business_profile)) {
    const run = await businessProfile
      .ensureBusinessProfile(db as never, prospect, businessProfile.profileAsk(prospect.id), { persist: options.persist === true })
      .catch((error: unknown) => ({ profile: null, refreshed: false, note: error instanceof Error ? error.message : "lecture impossible" }));
    if (run.profile) prospect.business_profile = run.profile as unknown as Record<string, unknown>;
    profileNote = run.refreshed ? "site lu pour l'occasion (non enregistré)" : run.note;
  }
  const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  const contact = prospect.email
    ? { email: prospect.email, full_name: text(figures.contact_name), position: text(figures.contact_position), confidence: typeof figures.contact_confidence === "number" ? figures.contact_confidence : null }
    : null;
  const factsResult = buildFacts(prospect, contact);
  let brief = isBrief(prospect.brief) ? prospect.brief : null;
  if (!brief) {
    const outcome = await runStrategist((system, user, operation) => ask("strategist", system, user, 0.2, operation), {
      facts: factsResult.facts,
      companyName: factsResult.companyName,
      isLargeGroupSubsidiary: factsResult.isLargeGroupSubsidiary,
      parentGroup: text(figures.parent_group) ?? factsResult.parent,
      foreignEntities: factsResult.foreignEntities,
      history: [],
      sector: prospect.sector,
    });
    if (!outcome.brief) return { outcome: { error: `stratège : ${outcome.error}` }, civilities: {}, greeting: "" };
    brief = outcome.brief;
  }
  const civilities = { ...((figures.civilites as Record<string, "M" | "F" | "?"> | undefined) ?? {}) };
  const input = {
    email: prospect.email,
    leaderPerson: factsResult.leaderPerson,
    contactName: text(figures.contact_name),
    addressee: incomingLeader(figures)?.fullName ?? null,
    contactIsRecipient: Boolean(prospect.contact_name && prospect.email),
    addresseeHint: greeting.addresseeHintOf(figures),
  };
  const unknown = greeting.unknownFirstName(input, civilities);
  if (unknown) civilities[greeting.cacheKey(unknown)] = await greeting.askCivility(ask, unknown, greeting.greetingPerson(input)?.last ?? "");
  const salutation = greeting.buildQualityGreeting(input, civilities);
  const { offer } = await loadOffer(db as never, userId);
  const profile = storedProfile(prospect.business_profile);
  const outcome = await quality.generateQualityDraft({
    ask,
    brief,
    facts: factsResult.facts,
    prospectId: prospect.id,
    companyName: brief.companyName || singleCompanyName(prospect.company_name),
    activity: profile?.offer ?? prospect.sector ?? null,
    sector: prospect.sector ?? null,
    recipientRole: prospect.contact_role ?? text(figures.contact_role) ?? text(figures.contact_position),
    prospectText: [JSON.stringify(prospect.business_profile ?? {}), prospect.website ?? "", ...(prospect.signals ?? []).map((signal) => signal.label)].join(" "),
    greeting: salutation,
    signature: signatureFor(offer),
    forbiddenNames: factsResult.foreignEntities,
    offerNumbers: offerNumbers(offer),
    usedCliches: options.usedCliches,
    dayOpenings: options.dayOpenings,
    website: prospect.website,
    family: options.family,
    keyFacts: factsGate.keyFactsOf(figures),
  });
  return { outcome, civilities, greeting: salutation, brief, profileNote, foundSite };
}
