import { singleCompanyName } from "@/lib/company-name";
import { z } from "zod";
import { getOpenAI } from "@/lib/openai";
import { AiCallError, chatJson, type AskFn } from "@/lib/ai/chat";
import { recordOpenAiUsage } from "@/lib/usage/record";
import {
  fetchQuota,
  findDecisionMaker,
  findEmailByName,
  hasHunterKey,
  isCommercialPosition,
  isDecisionMakerPosition,
} from "@/lib/enrichment/hunter";
import { toDomain } from "@/lib/enrichment/http";
import type { DecisionMakerContact, EnrichmentWarning } from "@/lib/enrichment/types";
import { buildFacts } from "@/lib/emails/derived-facts";
import { hookReadiness } from "@/lib/emails/hook-readiness";
import { incomingLeader, leaderEmailQuery } from "@/lib/emails/incoming-leader";
import { dateUndatedSignals } from "@/lib/signals/dating";
import {
  BRIEF_SCHEMA,
  runStrategist,
  validateBrief,
  type BriefAngle,
  type BriefOutcome,
  type HistoryMessage,
  type StrategistInput,
  type StrategyBrief,
} from "@/lib/emails/strategist";
import { describesNeed, needConfidence } from "@/lib/emails/need-lead";
import { edges, maxSimilarity } from "@/lib/similarity";
import { coerceTone } from "@/lib/tones";
import { activeProspects } from "@/lib/trash/scope";
import { offTargetReason } from "@/lib/funnel/off-target";
import { loadOffer } from "@/lib/offer/read";
import type { MessageOrigin, Prospect } from "@/types";
import { offerNumbers } from "@/app/api/emails/generate/pipeline";
import { generateQualityDraft } from "@/lib/emails/quality/generate";
import { recordDraftVariant } from "@/lib/emails/quality/variant";
import { clichesOf } from "@/lib/emails/quality/rules";
import { hookOfBody, opensWithAvec } from "@/lib/emails/quality/readiness";
import { askCivility, buildQualityGreeting, cacheKey, greetingPerson, unknownFirstName, type CivilityCache } from "@/lib/emails/quality/greeting";
import { replaceDraft } from "@/lib/emails/quality/versions";
import { signatureFor } from "@/lib/offer/model";
import { storedProfile } from "@/lib/emails/business-profile";
import { ensureBusinessProfile, profileAsk } from "../business-profile";
import type { Evidence } from "@/app/api/emails/generate/prompt";
import { JobError, type JobHandler, type StepContext, type StepOutcome } from "../runner";
import { findContact as findContactOnSite } from "@/lib/contact-finder";
import { findSiteFree, siteIdentity } from "@/lib/contact-finder/free-site";
import { realDeps as realContactDeps } from "@/lib/contact-finder/clients";

/**
 * Génération d'un mail, en trois étapes reprenables :
 *
 *   1. contact  — Hunter (mode `full` seulement), vérifications du prospect ;
 *   2. brief    — le stratège (ou le brief édité, revalidé) ;
 *   3. draft    — rédacteur + juge + une réécriture, puis brouillon en base.
 *
 * Chaque étape range son résultat dans `state` : une reprise ne rappelle ni
 * Hunter ni le stratège une seconde fois.
 */

const SIMILARITY_LIMIT = 0.4;
const HISTORY = 10;

const CONTACT_SCHEMA = z.object({
  email: z.string(),
  full_name: z.string().nullable(),
  position: z.string().nullable(),
  confidence: z.number().nullable(),
});

const ANGLE_SCHEMA = BRIEF_SCHEMA.shape.angle;

export const EMAIL_PARAMS_SCHEMA = z.object({
  prospectId: z.string().min(1),
  tone: z.string().optional(),
  /**
   * - full        : chaîne complète, contact Hunter compris ;
   * - other_angle : relance UNIQUEMENT le stratège, angles précédents exclus.
   *                 Aucun appel Linkup, Pappers ni Hunter ;
   * - rewrite     : rédacteur seul, depuis le brief (éventuellement édité).
   */
  mode: z.enum(["full", "other_angle", "rewrite"]).default("full"),
  cachedContact: CONTACT_SCHEMA.nullish(),
  /** Angles déjà proposés, cumulés côté client pour faire tourner les angles. */
  excludeAngles: z.array(ANGLE_SCHEMA).max(10).optional(),
  /** Brief édité à la main, pour le mode `rewrite`. Revalidé ici. */
  brief: z.unknown().optional(),
  /**
   * Enregistre le brouillon dans `messages` (→ `result.messageId`). L'écran
   * Prospection actuel l'enregistre lui-même à la validation : il passe
   * `false` pour ne pas créer de doublon.
   */
  saveDraft: z.boolean().default(true),
  /**
   * Provenance du brouillon : `eval` (eval:mails) ou `script`. Un tel brouillon
   * est marqué (`messages.origin`), n'apparaît jamais dans « Aujourd'hui » et ne
   * réécrit jamais le brouillon de l'application — ni l'inverse.
   */
  origin: z.enum(["eval", "script"]).nullish(),
  /**
   * Job lancé SANS CLIC (préparation du matin, fiche complétée). Un brouillon
   * retouché à la main (`messages.edited_by_hand`) n'est alors jamais réécrit.
   */
  auto: z.boolean().optional(),
  /**
   * Brouillon déjà en base pour ce prospect (génération précédente) : il est
   * RÉÉCRIT au lieu d'en créer un second, tant qu'il n'est pas parti.
   */
  replaceMessageId: z.string().min(1).nullish(),
  /**
   * « Générer quand même » : passe outre l'absence d'accroche forte.
   *
   * Le brouillon produit est marqué « générique » — il reste utile comme base,
   * mais on sait pourquoi il est faible.
   */
  force: z.boolean().optional(),
  /**
   * Contact déjà cherché au creusage (préparation de « Aujourd'hui ») : le
   * mode `full` reprend l'adresse de la fiche au lieu de rappeler Hunter —
   * un crédit par fiche, pas deux. Sans adresse sur la fiche, chaîne normale.
   */
  storedContact: z.boolean().optional(),
});
export type EmailParams = z.infer<typeof EMAIL_PARAMS_SCHEMA>;

function paramsOf(ctx: StepContext): EmailParams {
  const parsed = EMAIL_PARAMS_SCHEMA.safeParse(ctx.job.params);
  if (!parsed.success) throw new JobError("Requête invalide.", false, 400);
  // `email_rewrite` n'a qu'un sens : rédacteur seul depuis le brief.
  return ctx.job.type === "email_rewrite" ? { ...parsed.data, mode: "rewrite" } : parsed.data;
}

/** Prospect vivant de CET utilisateur (client service_role : filtre explicite). */
async function loadProspect(ctx: StepContext, id: string): Promise<Prospect> {
  const { data, error } = await activeProspects(ctx.db).eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (error) throw new Error(`lecture du prospect impossible : ${error.message}`);
  if (!data) throw new JobError("Prospect introuvable.", false, 404);
  return data as Prospect;
}

/**
 * Recherche du contact nominatif — au moment du brouillon, jamais avant.
 * L'absence de contact est un résultat acceptable (« Bonjour, »).
 */
export interface ContactOutcome {
  contact: DecisionMakerContact | null;
  warning?: EnrichmentWarning;
  /**
   * Autres personnes trouvees sur le domaine.
   *
   * Conservees pour l'arbitrage d'apres le PAIN, qui n'est connu qu'a l'etape
   * suivante : un commercial devient le bon destinataire quand le besoin porte
   * sur la vente, et reste le mauvais quand il porte sur les operations.
   */
  candidates?: DecisionMakerContact[];
}

export async function findContact(prospect: Prospect): Promise<ContactOutcome> {
  const domain = toDomain(prospect.website);
  if (!domain) return { contact: null, warning: { source: "hunter", message: "aucun site connu" } };
  if (!hasHunterKey()) {
    return { contact: null, warning: { source: "hunter", message: "cle absente : decideur non recherche" } };
  }

  const figures = prospect.key_figures ?? {};
  const leaderPerson = typeof figures.leader_person === "string" ? figures.leader_person : null;
  const leader = typeof figures.leader === "string" ? figures.leader : null;
  const known = leaderPerson ?? leader;

  /*
   * L'ordre, et POURQUOI cet ordre.
   *
   * Constate le 27/09/2026 sur SELECTION HABITAT : Hunter rend dix contacts
   * nominatifs sur le domaine — dont « Business Development Director » a 97 % —
   * et l'ecran affichait « aucun decideur trouve ». Deux raisons, cumulees :
   * la liste blanche des postes ne reconnaissait aucun de ces intitules, et
   * l'`email-finder` etait appele avec « Louis Alain Vilain » comme nom de
   * famille (tout sauf le premier mot), donc ne trouvait rien.
   *
   * Desormais : le dirigeant du registre est TOUJOURS cherche — recherche de
   * domaine, puis email-finder sur prenom + nom, meme si la premiere a echoue —
   * et faute de decideur on se rabat sur le meilleur contact nominatif reel.
   * Ecrire a une personne dont on connait le nom, quitte a ce qu'elle
   * transmette, vaut mieux que « Bonjour, » a personne.
   */

  // 0. Un dirigeant qui vient d'arriver passe devant tout le reste : c'est a
  // lui qu'on ecrit, et c'est son arrivee qui porte l'accroche.
  const newLeader = incomingLeader(figures);
  const query = newLeader ? leaderEmailQuery(newLeader, prospect.website) : null;
  if (query) {
    const incoming = await findEmailByName(query.domain, query.firstName, query.lastName, prospect.id);
    if (incoming.ok && incoming.data) return { contact: incoming.data };
  }

  // 1. LE DIRIGEANT D'ABORD, quand le registre en nomme un.
  //
  // C'est lui qui arbitre la facon dont le travail circule chez lui. Chercher
  // son adresse coute un appel et la donne dans la majorite des cas ; passer
  // par la recherche de domaine d'abord faisait sortir un commercial et on
  // s'arretait la. Constate sur MAISONS TERRE D'OC : l'adresse du president
  // etait meme deja sur la fiche.
  const named = (known ?? "").trim().split(/\s+/).filter(Boolean);
  if (named.length >= 2) {
    const direct = await findEmailByName(domain, named[0], named[named.length - 1], prospect.id);
    if (direct.ok && direct.data) return { contact: direct.data };
    if (!direct.ok && direct.quotaExceeded) {
      return { contact: null, warning: { source: "hunter", message: "quota de recherches atteint pour ce mois" } };
    }
  }

  // 2. Recherche de domaine : un decideur, et la liste des personnes trouvees.
  const search = await findDecisionMaker(domain, known, prospect.id);
  if (search.ok && search.data.contact) return { contact: search.data.contact };

  if (!search.ok && search.quotaExceeded) {
    const quota = await fetchQuota();
    const detail = quota
      ? `quota atteint (${quota.used}/${quota.available} recherches du plan ${quota.planName ?? "en cours"})`
      : "quota de recherches atteint pour ce mois";
    return { contact: null, warning: { source: "hunter", message: detail } };
  }

  // 3. Repli : le meilleur contact nominatif du domaine, sans second appel.
  const fallback = search.ok ? search.data.candidates[0] : null;
  const candidates = search.ok ? search.data.candidates : [];
  if (fallback) {
    return {
      contact: fallback,
      candidates,
      warning: {
        source: "hunter",
        message:
          `aucun dirigeant sur ce domaine : contact retenu ${fallback.full_name ?? fallback.email}` +
          `${fallback.position ? ` (${fallback.position})` : ""}`,
      },
    };
  }

  // 4. Rien : on le dit, et on ecrit « Bonjour, ».
  const reason = search.ok ? "aucun contact nominatif trouve sur ce domaine" : search.error;
  return { contact: null, candidates, warning: { source: "hunter", message: reason } };
}

function storedAngle(prospect: Prospect): BriefAngle | null {
  const parsed = ANGLE_SCHEMA.safeParse((prospect.brief as { angle?: unknown } | null | undefined)?.angle);
  return parsed.success ? parsed.data : null;
}

/** Famille (message_variants) des mails d'intro du jour. */
async function todayFamilies(db: StepContext["db"], ids: readonly string[]): Promise<Map<string, string>> {
  const families = new Map<string, string>();
  if (!ids.length) return families;
  const { data } = await (db as unknown as { from: (table: string) => any }).from("message_variants").select("message_id, family").in("message_id", ids.slice(0, 200));
  for (const row of (data ?? []) as { message_id: string; family: string | null }[]) if (row.family) families.set(row.message_id, row.family);
  return families;
}

/** Ouvertures du jour : total, « Avec », et la même chose par famille. */
export function openingsOf(rows: readonly { id: string; body: string }[], familyOf: ReadonlyMap<string, string>) {
  const byFamily: Record<string, { total: number; avec: number }> = {};
  let avec = 0;
  for (const row of rows) {
    const opens = opensWithAvec(hookOfBody(row.body));
    if (opens) avec += 1;
    const family = familyOf.get(row.id);
    if (!family) continue;
    byFamily[family] ??= { total: 0, avec: 0 };
    byFamily[family].total += 1;
    if (opens) byFamily[family].avec += 1;
  }
  return { total: rows.length, avec, byFamily };
}

function askFor(prospectId: string): AskFn {
  return (role, system, user, temperature, operation) =>
    chatJson({
      client: getOpenAI(),
      role,
      system,
      user,
      temperature,
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

/** Un paramètre refusé par le modèle ne se corrige pas en réessayant. */
async function guardAi<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AiCallError) throw new JobError(error.message, false, 502);
    throw error;
  }
}

const warningsOf = (ctx: StepContext) => (ctx.job.state.warnings as EnrichmentWarning[] | undefined) ?? [];
const contactOf = (ctx: StepContext) => (ctx.job.state.contact as DecisionMakerContact | null | undefined) ?? null;
const candidatesOf = (ctx: StepContext) =>
  (ctx.job.state.candidates as DecisionMakerContact[] | undefined) ?? [];

/**
 * Le besoin porte-t-il sur la VENTE ?
 *
 * C'est la seule question qui rend un commercial preferable au dirigeant. Un
 * devis a produire, un rendez-vous a caler, un prospect a relancer : il est
 * concerne. Un dossier a constituer, une facture a rapprocher, un planning a
 * tenir : c'est le dirigeant qui arbitre, et ecrire au commercial fait perdre
 * le mail.
 */
const COMMERCIAL_PAIN =
  /devis|prospect|prospection|relance commerciale|rendez-vous|rdv|vente|vendeur|client entrant|demande entrante|lead/i;

export function painIsCommercial(pain: string): boolean {
  return COMMERCIAL_PAIN.test(pain);
}

/**
 * Destinataire final, une fois le besoin connu.
 *
 * `findContact` a pu retenir un commercial faute de mieux. Si le besoin n'est
 * PAS commercial et qu'un decideur figure parmi les autres personnes trouvees,
 * c'est lui qu'on prend. Sinon on garde le commercial : il transmettra.
 */
export function chooseRecipient(
  contact: DecisionMakerContact | null,
  candidates: readonly DecisionMakerContact[],
  pain: string,
): DecisionMakerContact | null {
  if (!contact || painIsCommercial(pain)) return contact;
  if (!isCommercialPosition(contact.position)) return contact;

  // On ne se rabat que sur un DECIDEUR. Prendre « n'importe qui de non
  // commercial » ferait descendre d'un directeur du developpement a un agent :
  // moins commercial, mais moins bien place encore.
  return candidates.find((item) => isDecisionMakerPosition(item.position)) ?? contact;
}

const progress = (step: string, pct: number) => ({ step, pct, counts: { scanned: 0, signals: 0, sheets: 0 } });

/**
 * Jalons de la barre de /prospection : analyse → stratège → rédaction → juge.
 * L'écran lit le pourcentage ; le libellé est déjà rédigé pour lui.
 */
export const EMAIL_STAGES = {
  analyse: progress("Analyse de la fiche", 5),
  strategist: progress("Stratège : choix de l'angle", 25),
  writer: progress("Rédaction du mail", 50),
  judge: progress("Juge : relecture critique", 75),
  rewrite: progress("Réécriture après le juge", 85),
  done: progress("Brouillon prêt", 100),
} as const;

/** Vérifications partagées par la route et le job. Rend l'erreur, ou null. */
export function emailBlocker(prospect: Prospect): { message: string; status: number } | null {
  // Un prospect perdu est clos : générer, c'est relancer quelqu'un qui a dit non.
  if (prospect.status === "perdu") {
    return {
      message: "Prospect clôturé : ce prospect est marqué « Perdu », la génération est désactivée.",
      status: 409,
    };
  }
  // Offres publiées pour des clients (temps partagé, recrutement…) : aucun
  // brouillon, le signal ne concerne pas l'entreprise elle-même.
  const forClient = offTargetReason(prospect);
  if (forClient?.startsWith("signal pour un client")) {
    return { message: `Hors cible — ${forClient}. Aucun brouillon.`, status: 409 };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { message: "OPENAI_API_KEY absente : la génération est indisponible.", status: 503 };
  }
  return null;
}

async function contactStep(ctx: StepContext): Promise<StepOutcome> {
  const params = paramsOf(ctx);
  const prospect = await loadProspect(ctx, params.prospectId);
  const blocker = emailBlocker(prospect);
  if (blocker) throw new JobError(blocker.message, false, blocker.status);
  await ctx.progress(EMAIL_STAGES.analyse).catch(() => undefined);

  const warnings: EnrichmentWarning[] = [];
  let contact: DecisionMakerContact | null;
  // Gardes pour l'arbitrage d'apres le pain, a l'etape de redaction.
  let candidates: DecisionMakerContact[] = [];
  const figures = prospect.key_figures ?? {};
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  // Contact NOMINATIF déjà choisi pour la fiche (Hunter, selon le sujet) : c'est
  // à lui qu'on écrit — le job ne va pas en chercher un autre (06/10/2026).
  const chosen = Boolean(prospect.email && prospect.contact_name && prospect.email_type === "nominatif");
  if (params.mode === "full" && prospect.email && (params.storedContact || chosen)) {
    contact = {
      email: prospect.email,
      full_name: text(prospect.contact_name) ?? text(figures.contact_name) ?? text(figures.leader_person),
      position: text(prospect.contact_role) ?? text(figures.contact_position),
      confidence: prospect.contact_confidence ?? (typeof figures.contact_confidence === "number" ? figures.contact_confidence : null),
    };
  } else if (params.mode === "full") {
    const outcome = await findContact(prospect).catch(() => ({ contact: null, warning: undefined, candidates: [] }));
    contact = outcome.contact;
    candidates = outcome.candidates ?? [];
    if (outcome.warning) warnings.push(outcome.warning);
    // Hunter n'a rien donné et la fiche n'a pas d'adresse : le module contact
    // cherche le vrai site et l'adresse publiée (mentions légales, contact).
    if (!contact && !candidates.length && !prospect.email) {
      const found = await findContactOnSite(prospect.id, { db: ctx.db, userId: ctx.userId }).catch(() => null);
      if (found?.email) {
        contact = { email: found.email, full_name: null, position: null, confidence: found.confidence };
        warnings.push({
          source: "hunter",
          message: `adresse ${found.email_type === "nominatif" ? "nominative" : "générique"} trouvée par le module contact (${found.found_by})`,
        });
      }
    }
  } else {
    // Hors génération complète, AUCUN appel Hunter : le contact revient du client.
    contact = (params.cachedContact as DecisionMakerContact | null | undefined) ?? null;
  }
  return {
    state: { contact, candidates, warnings },
    result: { prospectIds: [prospect.id] },
    progress: params.mode === "rewrite" ? { ...EMAIL_STAGES.strategist, step: "Relecture du brief" } : EMAIL_STAGES.strategist,
  };
}

/**
 * JAMAIS DE BROUILLON AVEC UN PROFIL MÉTIER VIDE QUAND LA FICHE A UN SITE.
 *
 * 02/10/2026, NEW NET 3D : profil vide → accroche vague, pain « reporting »
 * hors sujet. Le site a été lu juste avant (génération complète) ; s'il n'en
 * sort aucun profil, on s'arrête AVANT le stratège et la rédaction : la fiche
 * garde « Profil à compléter », sans brouillon, et l'échec est daté
 * (`key_figures.profile_failed_at`) pour ne pas relancer en boucle.
 */
export async function requireProfileWhenSiteKnown(
  ctx: Pick<StepContext, "db" | "userId">,
  prospect: Prospect,
  warnings: { source: string; message: string }[] = [],
  now = new Date(),
): Promise<void> {
  const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
  const profile = storedProfile(prospect.business_profile);
  if (profile || !prospect.website) {
    if (profile && typeof figures.profile_failed_at === "string") {
      const { profile_failed_at: _cleared, ...rest } = figures;
      await ctx.db.from("prospects").update({ key_figures: rest }).eq("id", prospect.id).eq("user_id", ctx.userId);
    }
    return;
  }
  await ctx.db
    .from("prospects")
    .update({ key_figures: { ...figures, profile_failed_at: now.toISOString() } })
    .eq("id", prospect.id)
    .eq("user_id", ctx.userId);
  const why = warnings.map((warning) => warning.message).find((message) => /profil|site/i.test(message));
  throw new Error(`Profil à compléter : le site ${prospect.website} n'a pas pu être lu${why ? ` (${why})` : ""} — aucun brouillon rédigé.`);
}

async function briefStep(ctx: StepContext): Promise<StepOutcome> {
  const params = paramsOf(ctx);
  const prospect = await loadProspect(ctx, params.prospectId);
  const warnings = [...warningsOf(ctx)];

  // --- PROFIL MÉTIER : lu sur le site AVANT le stratège ------------------
  // Génération complète seulement : « autre angle » et « réécrire » relisent
  // le profil déjà stocké, sans nouvelle lecture du site.
  if (params.mode === "full") {
    // SITE INCONNU : recherche GRATUITE d'abord (domaines déduits du nom,
    // validés par les mentions légales) — pas de fait propre sans site.
    if (!prospect.website) {
      const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
      const found = await findSiteFree(
        siteIdentity({ id: prospect.id, name: prospect.company_name, tradeNames: [figures.commercial_name as string | null], siren: prospect.siren, city: prospect.city }),
        realContactDeps(prospect.id),
      ).catch(() => null);
      if (found) {
        await ctx.db.from("prospects").update({ website: found.website }).eq("id", prospect.id).is("website", null);
        prospect.website = found.website;
        warnings.push({ source: "openai", message: `site trouvé gratuitement : ${found.domain}` });
      }
    }
    const run = await ensureBusinessProfile(ctx.db, prospect, profileAsk(prospect.id)).catch((error: unknown) => ({
      profile: storedProfile(prospect.business_profile),
      refreshed: false,
      note: `profil métier non lu : ${error instanceof Error ? error.message : "erreur"}`,
    }));
    if (run.note) warnings.push({ source: "openai", message: run.note });
  }
  await requireProfileWhenSiteKnown(ctx, prospect, warnings);
  let factsResult = buildFacts(prospect, contactOf(ctx));

  // --- DERNIÈRE CHANCE DONNÉE AUX SIGNAUX SANS DATE -----------------------
  //
  // Un signal fort mais non daté valait mieux qu'un mail ouvert sur le code
  // NAF, et il suffisait parfois d'un aller-retour pour le sauver : la page
  // porte souvent sa date en JSON-LD, et le registre date les ouvertures
  // d'établissement. On ne paie ces allers-retours que si la fiche n'a AUCUNE
  // accroche — donc jamais en routine.
  if (params.mode === "full" && !hookReadiness(factsResult.facts).ready) {
    const dated = await dateUndatedSignals(prospect.signals ?? [], {
      siren: prospect.siren,
      city: prospect.city,
    }).catch(() => ({ signals: prospect.signals ?? [], changed: false }));

    if (dated.changed) {
      prospect.signals = dated.signals;
      await ctx.db.from("prospects").update({ signals: dated.signals }).eq("id", prospect.id);
      factsResult = buildFacts(prospect, contactOf(ctx));
    }
  }

  // --- GATING : pas de brouillon sans accroche forte ----------------------
  //
  // Sans signal daté ni fait de site, le stratège retombe sur l'angle
  // « métier » et le rédacteur sur le code NAF ou l'effectif. Le juge note
  // alors la spécificité 1 ou 2 sur 5, à raison. Trois appels de modèle pour
  // un mail qu'on n'enverra pas : autant le dire.
  const readiness = hookReadiness(factsResult.facts);
  if (!readiness.ready && !params.force) {
    throw new JobError(readiness.reason, false, 409, { needsFeeding: true, canForce: true });
  }

  for (const rejected of factsResult.rejectedSignals.filter(
    (item) => item.reason === "homonyme probable" || item.reason === "autre entreprise",
  )) {
    warnings.push({
      source: "linkup",
      message: `signal écarté, ${rejected.reason} : ${rejected.entity ?? rejected.label}`,
    });
  }

  const { data: sent } = await ctx.db
    .from("messages")
    .select("subject, body, sent_at")
    .eq("prospect_id", prospect.id)
    .eq("user_id", ctx.userId)
    .eq("status", "sent")
    .order("created_at", { ascending: true });

  const figures = prospect.key_figures ?? {};
  const excludeAngles = [...(params.excludeAngles ?? [])];
  const previous = storedAngle(prospect);
  if (params.mode === "other_angle" && previous) excludeAngles.push(previous);

  const input: StrategistInput = {
    facts: factsResult.facts,
    companyName: factsResult.companyName,
    isLargeGroupSubsidiary: factsResult.isLargeGroupSubsidiary,
    parentGroup: (typeof figures.parent_group === "string" ? figures.parent_group : null) ?? factsResult.parent,
    foreignEntities: factsResult.foreignEntities,
    history: (sent ?? []) as HistoryMessage[],
    excludeAngles: params.mode === "full" ? [] : excludeAngles,
    sector: prospect.sector,
    businessProfile: storedProfile(prospect.business_profile),
    nafCode: typeof figures.naf_code === "string" ? figures.naf_code : null,
  };

  let outcome: BriefOutcome;
  if (params.mode === "rewrite") {
    // Brief édité à la main : revalidé comme une sortie du modèle.
    outcome = validateBrief(params.brief, { ...input, excludeAngles: [] });
    if (outcome.brief) outcome.brief.excludedAngles = excludeAngles;
    if (!outcome.brief) throw new JobError(`Brief inexploitable : ${outcome.error}`, false, 502);
  } else {
    const ask = askFor(prospect.id);
    outcome = await guardAi(() =>
      runStrategist((system, user, operation) => ask("strategist", system, user, 0.2, operation), input),
    );
    // Sortie du modèle invalide : une nouvelle tentative a ses chances.
    if (!outcome.brief) throw new JobError(`Brief inexploitable : ${outcome.error}`, true, 502);
  }

  // Stocké avec le prospect : « Autre angle » s'en sert pour exclure l'angle.
  const saved = await ctx.db.from("prospects").update({ brief: outcome.brief }).eq("id", prospect.id);
  if (saved.error) {
    warnings.push({ source: "openai", message: "brief non enregistré : appliquez la migration 20260925100000_prospect_brief.sql" });
  }
  return { state: { brief: outcome.brief, warnings }, progress: EMAIL_STAGES.writer };
}

/** Le brouillon précédent n'est réécrit que s'il est à nous, à ce prospect, et pas parti. */
async function replaceableDraft(
  ctx: StepContext,
  prospectId: string,
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;
  const { data } = await ctx.db
    .from("messages")
    .select("id")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("prospect_id", prospectId)
    .eq("status", "draft")
    // Un brouillon à la corbeille ne se réécrit pas : la génération en crée un neuf.
    .is("deleted_at", null)
    // Un mail PROGRAMMÉ ou en cours d'envoi ne se réécrit jamais en douce.
    .not("send_status", "in", "(scheduled,sending)")
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Dernier brouillon d'intro non envoyé du prospect, quand l'appelant n'en
 * désigne pas : une nouvelle génération le RÉÉCRIT au lieu d'en empiler un
 * second. Jamais un mail programmé, en cours d'envoi ou à la corbeille.
 */
export async function latestIntroDraft(
  ctx: Pick<StepContext, "db" | "userId">,
  prospectId: string,
  origin: MessageOrigin | null = null,
): Promise<string | null> {
  // `select("*")` et filtre en mémoire : la colonne `origin` peut ne pas encore
  // exister entre le déploiement et la migration — la requête ne doit pas casser.
  const { data } = await ctx.db
    .from("messages")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("prospect_id", prospectId)
    .eq("type", "intro")
    .eq("status", "draft")
    .is("deleted_at", null)
    .not("send_status", "in", "(scheduled,sending)")
    .order("created_at", { ascending: false })
    .limit(20);
  const own = ((data ?? []) as { id: string; origin?: string | null }[]).find((row) => (row.origin ?? null) === origin);
  return own?.id ?? null;
}

async function draftStep(ctx: StepContext): Promise<StepOutcome> {
  const params = paramsOf(ctx);
  const prospect = await loadProspect(ctx, params.prospectId);
  const brief = ctx.job.state.brief as StrategyBrief | undefined;
  if (!brief) throw new JobError("brief manquant : l'étape précédente n'a pas abouti", false, 500);
  const contact = chooseRecipient(
    contactOf(ctx),
    candidatesOf(ctx),
    `${brief.pain.task} ${brief.pain.automationIdea}`,
  );
  const warnings = [...warningsOf(ctx)];
  const loaded = await loadOffer(ctx.db, ctx.userId);
  const factsResult = buildFacts(prospect, contact);
  const { facts, leaderPerson } = factsResult;

  // Anti-répétition : on interdit les ouvertures déjà servies, puis on MESURE.
  const { data: recent } = await ctx.db
    .from("messages")
    .select("body")
    .eq("user_id", ctx.userId)
    .eq("type", "intro")
    .order("created_at", { ascending: false })
    .limit(HISTORY);
  const previousBodies = (recent ?? []).map((row) => (row as { body: string }).body);
  const avoid = previousBodies.flatMap((text) => {
    const { opening, closing } = edges(text);
    return [opening, closing].filter(Boolean);
  });

  // --- Gabarit qualité (03/10/2026) : salutation, accroche, proposition,
  // démo avec lien, demande ; garde-fou + juge, 2 réécritures au plus.
  const figures = prospect.key_figures ?? {};
  const civilities = { ...((figures.civilites as CivilityCache | undefined) ?? {}) };
  const greetingInput = {
    email: contact?.email ?? prospect.email,
    leaderPerson,
    contactName: contact?.full_name ?? (typeof figures.contact_name === "string" ? figures.contact_name : null),
    addressee: incomingLeader(figures)?.fullName ?? null,
    // La personne contactée est connue (contact nominatif) : la salutation est la sienne.
    contactIsRecipient: Boolean(prospect.contact_name && (contact?.email ?? prospect.email) === prospect.email),
  };
  const unknown = unknownFirstName(greetingInput, civilities);
  if (unknown) {
    civilities[cacheKey(unknown)] = await askCivility(askFor(prospect.id), unknown, greetingPerson(greetingInput)?.last ?? "");
    // Gardée sur la fiche : la question ne se repose jamais pour ce prénom.
    await ctx.db.from("prospects").update({ key_figures: { ...figures, civilites: civilities } }).eq("id", prospect.id);
    prospect.key_figures = { ...figures, civilites: civilities };
  }
  const profile = storedProfile(prospect.business_profile);
  // Clichés de fin déjà servis dans les brouillons du jour : le nouveau varie.
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  // Tous les mails d'intro du jour (brouillons, validés, programmés, partis) : le
  // quota « Avec » vaut sur la journée ET par famille (BULLY, CAMEL DIAM : 2 F1 sur 2).
  const { data: todays } = await ctx.db
    .from("messages")
    .select("id, body")
    .eq("user_id", ctx.userId)
    .eq("type", "intro")
    .is("deleted_at", null)
    .neq("prospect_id", prospect.id)
    .gte("created_at", dayStart);
  const todayRows = (todays ?? []) as { id: string; body: string }[];
  const usedCliches = [...new Set(todayRows.flatMap((row) => clichesOf(row.body)))];
  const familyOf = await todayFamilies(ctx.db, todayRows.map((row) => row.id));
  const dayOpenings = openingsOf(todayRows, familyOf);
  const draft = await guardAi(() =>
    generateQualityDraft({
      ask: askFor(prospect.id),
      brief,
      facts,
      prospectId: prospect.id,
      companyName: brief.companyName || singleCompanyName(prospect.company_name),
      activity: profile?.offer ?? prospect.sector ?? null,
      sector: prospect.sector ?? null,
      // Poste de la personne réellement contactée (contacts nominatifs), sinon le poste trouvé par la recherche.
      recipientRole: prospect.contact_role ?? ((typeof figures.contact_role === "string" && figures.contact_role) || (typeof figures.contact_position === "string" && figures.contact_position) || contact?.position || null),
      prospectText: [JSON.stringify(prospect.business_profile ?? {}), prospect.website ?? "", ...(prospect.signals ?? []).map((signal) => signal.label)].join(" "),
      greeting: buildQualityGreeting(greetingInput, civilities),
      signature: signatureFor(loaded.offer),
      forbiddenNames: factsResult.foreignEntities,
      offerNumbers: offerNumbers(loaded.offer),
      usedCliches,
      dayOpenings,
      website: prospect.website,
    }),
  );
  if ("error" in draft) throw new JobError(draft.error, true, 502);
  if ("blocked" in draft) {
    // Pas de mail sans fait propre ni pain sûr : la raison est gardée sur la
    // fiche (« À revoir » dans Aujourd'hui), aucun brouillon, aucune reprise.
    await ctx.db
      .from("prospects")
      .update({ key_figures: { ...(prospect.key_figures ?? {}), mail_review: { reason: draft.blocked, at: new Date().toISOString() } } })
      .eq("id", prospect.id);
    // Un ancien brouillon (gabarit d'avant) ne reste pas en « Nouveaux » : il
    // passe en « À revoir » avec la raison, texte inchangé. Jamais un brouillon
    // retouché à la main.
    const stale = await latestIntroDraft(ctx, prospect.id);
    if (stale) {
      await ctx.db
        .from("messages")
        .update({ quality_reason: draft.blocked, quality_score: null })
        .eq("id", stale)
        .eq("status", "draft")
        .eq("edited_by_hand", false);
    }
    throw new JobError(`À revoir — ${draft.blocked}. Aucun brouillon.`, false, 409);
  }
  const email = { subject: draft.subject, body: draft.body };
  const best = draft.history.find((attempt) => attempt.body === draft.body);
  const validation = best?.rules ?? { ok: false, failures: [] };
  const critique = null;
  const failing = draft.needsReview && draft.reviewReason ? [draft.reviewReason] : [];

  const similarity = maxSimilarity(email.body, previousBodies);
  if (similarity > SIMILARITY_LIMIT) {
    warnings.push({ source: "openai", message: `Ce brouillon ressemble à ${Math.round(similarity * 100)} % à un mail déjà envoyé.` });
  }
  /*
   * Le contact trouve est ECRIT sur la fiche.
   *
   * L'ecran l'affichait depuis la reponse de generation, donc il disparaissait
   * au rechargement : la fiche ne gardait aucune trace de qui avait ete trouve.
   * L'adresse ne remplace jamais une adresse deja renseignee — elle a pu etre
   * saisie a la main — mais le NOM et le POSTE sont notes dans tous les cas.
   */
  if (contact && params.mode === "full") {
    await ctx.db
      .from("prospects")
      .update({
        ...(prospect.email ? {} : { email: contact.email }),
        key_figures: {
          ...prospect.key_figures,
          contact_email: contact.email,
          ...(contact.full_name ? { contact_name: contact.full_name } : {}),
          ...(contact.position ? { contact_position: contact.position } : {}),
          ...(contact.confidence != null ? { contact_confidence: contact.confidence } : {}),
        },
      })
      .eq("id", prospect.id);
  }

  const confidence = needConfidence({
    facts,
    hasSiteContent: figures.site_status === "lu",
    vocabularyConfirmed: Array.isArray(figures.site_vocabulary) && figures.site_vocabulary.length > 0,
  });
  const evidence: Evidence[] = facts.map((fact) => ({
    label: fact.label,
    value: fact.value,
    source: fact.source,
    ...(fact.url ? { url: fact.url } : {}),
  }));
  const leadText = brief.angle.insight;

  let messageId: string | undefined;
  if (params.saveDraft) {
    // Écrit en dernier, juste avant le commit de l'étape : seule une coupure
    // entre les deux laisserait un brouillon en double (jamais un mail envoyé).
    const origin = params.origin ?? null;
    const existing =
      ctx.job.result.messageId ??
      (origin ? null : await replaceableDraft(ctx, prospect.id, params.replaceMessageId)) ??
      (await latestIntroDraft(ctx, prospect.id, origin));
    const quality = { quality_score: draft.score, quality_reason: draft.needsReview ? draft.reviewReason : null };
    if (existing) {
      const saved = await replaceDraft(ctx, existing, { subject: email.subject.trim() || null, body: email.body.trim(), ...quality }, {
        auto: params.auto === true,
        reason: params.auto ? "régénération automatique" : "régénération demandée",
      });
      if (saved === "edited") warnings.push({ source: "openai", message: "Brouillon retouché à la main : il n'est pas réécrit automatiquement." });
      if (saved === "locked") warnings.push({ source: "openai", message: "Brouillon validé ou programmé : il n'est pas réécrit automatiquement." });
      messageId = existing;
    } else {
      const { data, error } = await ctx.db
        .from("messages")
        .insert({
          prospect_id: prospect.id,
          user_id: ctx.userId,
          type: "intro",
          subject: email.subject.trim() || null,
          body: email.body.trim(),
          status: "draft",
          ...quality,
          // Seulement hors application : la colonne n'est jamais citée sinon.
          ...(origin ? { origin } : {}),
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`brouillon non enregistré : ${error?.message ?? "inconnue"}`);
      messageId = data.id;
    }
  }

  // Variante mesurée (lib/variants/record.ts) : expérience n° 1 = style d'objet.
  // Ne lève jamais — mesurer ne doit pas casser la rédaction.
  if (messageId) {
    await recordDraftVariant(ctx.db, { messageId, userId: ctx.userId, brief, outcome: draft });
  }

  // Un brouillon existe enfin : l'ancien « À revoir faute de matière » tombe.
  const reviewed = (prospect.key_figures ?? {}) as Record<string, unknown>;
  if (messageId && reviewed.mail_review) {
    const { mail_review: _cleared, ...rest } = reviewed;
    await ctx.db.from("prospects").update({ key_figures: rest }).eq("id", prospect.id);
  }

  const response = {
    pain_point: brief.pain.task,
    evidence,
    email,
    brief,
    facts,
    contact,
    warnings,
    critique,
    /** Les points qui n'ont pas pu être corrigés : l'UI affiche « à revoir ». */
    needsReview: draft.needsReview,
    qualityScore: draft.score,
    /**
     * Brouillon produit malgré l'absence d'accroche forte (« Générer quand
     * même »). Il reste utile comme base, mais il ne doit jamais partir tel
     * quel sans qu'on sache pourquoi il est faible.
     */
    generic: !hookReadiness(facts).ready,
    reviewReasons: draft.needsReview && draft.reviewReason ? [draft.reviewReason] : [],
    needLead: describesNeed(`${leadText} ${brief.pain.task}`)
      ? {
          text: leadText,
          factIds: brief.angle.hookFactIds,
          confidence: confidence.value,
          confidenceDetail: confidence.explanation,
        }
      : null,
  };

  return {
    state: { response },
    result: { prospectIds: [prospect.id], ...(messageId ? { messageId } : {}) },
    progress: EMAIL_STAGES.done,
  };
}

export const emailHandler: JobHandler = { steps: [contactStep, briefStep, draftStep] };
