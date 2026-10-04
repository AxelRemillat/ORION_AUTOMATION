import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactResult } from "@/lib/contact-finder";
import { HUNTER_EPUISE } from "@/lib/hunter/gate";
import { contactBadge } from "@/lib/funnel/dig";
import { filterSignal } from "@/lib/funnel/filter";
import type { FunnelPrefs } from "@/lib/funnel/settings";
import { rowToSignal, updateCandidate } from "@/lib/funnel/store";
import type { Identity } from "@/lib/funnel/types";
import type { Database, Prospect, SignalCandidateRow } from "@/types";
import { exclusionOf } from "./items";
import { shouldRetryCompletion } from "./tags";

/**
 * Complétion des fiches « À compléter » : ORION essaie seul avant de les
 * laisser à Axel.
 *
 * La chaîne est celle du module contact (`findContact`) : site, mentions
 * légales, Joomla, second domaine → Linkup → Hunter, ce dernier dans le budget
 * du jour (lib/contact-finder/policy.ts). Une tentative par run, trois au plus ;
 * ensuite la fiche est « à compléter manuellement ». Le bouton « Compléter avec
 * ORION » passe outre ce plafond (`force`) : c'est une demande explicite.
 *
 * Rien n'est effacé : le contact trouvé est FUSIONNÉ dans `contact`, et
 * l'adresse n'écrase jamais une adresse déjà saisie sur la fiche.
 *
 * COMPLÉTION AUTOMATIQUE (Cowork, 05/10/2026) — le goulot était le SITE :
 *   1. site résolu d'abord (`resolveSite` : URL connues → domaines du nom →
 *      Linkup plafonné), écrit sur la fiche s'il manquait ;
 *   2. email : pages du site, puis Hunter (règles existantes) ; une adresse
 *      dont le domaine n'a pas de MX est écartée ;
 *   3. profil métier lu dès que le site est trouvé ;
 *   4. trois tentatives sans site NI email : « Non joignable » — la fiche
 *      sort de « À compléter » (rien n'est supprimé, elle reste au Pipeline).
 */

type Db = SupabaseClient<Database>;

export interface CompletionDeps {
  findContact: (prospectId: string) => Promise<ContactResult>;
  /** Motif si Hunter est bloqué (crédits, budget du jour), `null` sinon. */
  hunterBlocked?: () => Promise<string | null>;
  /**
   * Site de la fiche : connu, ou résolu et ÉCRIT sur la fiche ; `unreadable` :
   * un domaine du nom existe mais refuse les lectures automatiques (403 —
   * SAIREM, 05/10) ; `null` : rien.
   */
  resolveSite?: (row: SignalCandidateRow) => Promise<{ website: string; found: boolean } | { unreadable: string } | null>;
  /** Lecture du profil métier (site tout juste trouvé). */
  readProfile?: (prospectId: string) => Promise<void>;
  /** Le domaine reçoit-il du courrier ? `null` = incertain (on garde). */
  hasMx?: (domain: string) => Promise<boolean | null>;
  /** Passe la fiche en « Non joignable » (fiche gardée, motif daté). */
  markUnreachable?: (prospectId: string, reason: string) => Promise<void>;
}

/** Tentatives au-delà desquelles une fiche sans site ni email est « Non joignable ». */
export const UNREACHABLE_AFTER = 3;

type ContactJson = { attempts?: number; last_attempt_run?: string; retried_at?: string } & Record<string, unknown>;

export const attemptsOf = (contact: ContactJson | null) => contact?.attempts ?? (contact?.retried_at ? 1 : 0);

/** Une tentative sur une fiche. Renvoie `true` si un email a été trouvé. */
export async function completeOne(
  db: Db,
  row: SignalCandidateRow,
  input: { deps: CompletionDeps; runId: string; now?: Date },
): Promise<{ found: boolean; email: string | null; website: string | null; unreachable: boolean }> {
  const previous = (row.contact as ContactJson | null) ?? {};
  // 1. Le SITE d'abord : sans domaine, ni la page contact ni Hunter ne peuvent rien.
  const resolved = input.deps.resolveSite ? await input.deps.resolveSite(row).catch(() => null) : null;
  const site = resolved && "website" in resolved ? resolved : null;
  // Site protégé contre les robots : on ne contourne pas la protection ; une
  // personne, elle, peut l'ouvrir — la fiche reste « À compléter ».
  const unreadable = resolved && "unreadable" in resolved ? resolved.unreadable : null;
  let contact = await input.deps.findContact(row.prospect_id!).catch(() => null);
  // 2. Une adresse sur un domaine sans MX ne recevra jamais le mail.
  const domain = contact?.email?.split("@")[1];
  if (contact?.email && domain && input.deps.hasMx && (await input.deps.hasMx(domain)) === false) {
    contact = { ...contact, email: undefined, email_type: undefined, found_by: `${contact.found_by} (écartée : domaine sans MX)` };
  }
  // 3. Site tout juste trouvé : le profil métier est lu tout de suite.
  if (site?.found && input.deps.readProfile) await input.deps.readProfile(row.prospect_id!).catch(() => undefined);
  // Hunter retenu faute de crédit : la tentative ne compte pas, elle sera refaite.
  const starved = Boolean(contact?.hunter_skipped?.startsWith(HUNTER_EPUISE)) && !contact?.email;
  await updateCandidate(db, row.id, {
    publication: contact?.email ? "pret" : "a_completer",
    contact: {
      ...previous,
      ...(contact ?? {}),
      badge: contactBadge(contact),
      ...(starved
        ? {}
        : {
            attempts: attemptsOf(previous) + 1,
            last_attempt_run: input.runId,
            retried_at: (input.now ?? new Date()).toISOString(),
          }),
      ...(site ? { website: site.website } : {}),
      ...(unreadable ? { site_unreadable: unreadable } : {}),
    },
  });
  // 4. Trois tentatives sans site ni email : « Non joignable ».
  const attempts = starved ? attemptsOf(previous) : attemptsOf(previous) + 1;
  const unreachable = !contact?.email && !site && !unreadable && attempts >= UNREACHABLE_AFTER;
  if (unreachable && input.deps.markUnreachable) {
    await input.deps.markUnreachable(row.prospect_id!, `${attempts} tentatives sans site ni email`).catch(() => undefined);
  }
  return { found: Boolean(contact?.email), email: contact?.email ?? null, website: site?.website ?? null, unreachable };
}

/**
 * Étape de complétion d'un run de préparation : les fiches « à compléter » de
 * TOUS les runs (30/09, 01/10 compris), dans le temps imparti.
 */
export async function runCompletionStage(
  db: Db,
  userId: string,
  runId: string,
  options: {
    deps: CompletionDeps;
    prefs?: Pick<FunnelPrefs, "preferredSectors" | "excludedSectors">;
    limit: number;
    deadline: number;
    now?: Date;
    /** Re-filtre (règles du jour) ; injecté par les tests, `filterSignal` sinon. */
    refilter?: (row: SignalCandidateRow) => { status: string; reason?: string };
  },
) {
  const blocked = await (options.deps.hunterBlocked?.() ?? Promise.resolve(null));
  const { data } = await db
    .from("signal_candidates")
    .select("*")
    .eq("user_id", userId)
    .eq("statut", "creusé")
    .eq("publication", "a_completer")
    .not("prospect_id", "is", null)
    .limit(200);
  const due = ((data ?? []) as SignalCandidateRow[]).filter((row) => {
    const contact = row.contact as ContactJson | null;
    return shouldRetryCompletion({ attempts: attemptsOf(contact), lastAttemptRun: contact?.last_attempt_run, runId });
  });

  // Opposée, « ne plus contacter », hors cible : AUCUNE complétion (ni gratuite
  // ni Hunter) — la fiche ne partira jamais (ADJUVOO, 02/10/2026).
  const ids = due.map((row) => row.prospect_id as string);
  const { data: owners } = ids.length
    ? await db.from("prospects").select("*").eq("user_id", userId).in("id", ids)
    : { data: [] };
  const byId = new Map(((owners ?? []) as Prospect[]).map((prospect) => [prospect.id, prospect]));

  let tried = 0;
  let found = 0;
  let refiltered = 0;
  let excluded = 0;
  for (const row of due) {
    if (tried >= options.limit || Date.now() > options.deadline) break;
    const owner = byId.get(row.prospect_id as string) ?? null;
    if (!owner || owner.deleted_at || exclusionOf(owner)) {
      excluded += 1;
      continue;
    }
    // Re-filtrée avec les règles du jour AVANT toute recherche payante.
    const verdict =
      options.refilter?.(row) ??
      filterSignal(rowToSignal(row), row.identity as unknown as Identity | null, { ...options.prefs, now: options.now });
    if (verdict.status === "rejeté") {
      await updateCandidate(db, row.id, { statut: "rejeté", motif_rejet: `re-filtré : ${verdict.reason}` });
      refiltered += 1;
      continue;
    }
    // Hunter bloqué, site déjà connu et recherche gratuite déjà faite : on
    // attend le retour des crédits. Sans site, la recherche de site vaut la peine.
    if (blocked && owner.website && attemptsOf(row.contact as ContactJson | null) > 0) continue;
    tried += 1;
    if ((await completeOne(db, row, { deps: options.deps, runId, now: options.now })).found) found += 1;
  }
  return { due: due.length, tried, found, refiltered, excluded };
}
