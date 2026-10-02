import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactResult } from "@/lib/contact-finder";
import { HUNTER_EPUISE } from "@/lib/hunter/gate";
import { contactBadge } from "@/lib/funnel/dig";
import { filterSignal } from "@/lib/funnel/filter";
import type { FunnelPrefs } from "@/lib/funnel/settings";
import { rowToSignal, updateCandidate } from "@/lib/funnel/store";
import type { Identity } from "@/lib/funnel/types";
import type { Database, SignalCandidateRow } from "@/types";
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
 */

type Db = SupabaseClient<Database>;

export interface CompletionDeps {
  findContact: (prospectId: string) => Promise<ContactResult>;
  /** Motif si Hunter est bloqué (crédits, budget du jour), `null` sinon. */
  hunterBlocked?: () => Promise<string | null>;
}

type ContactJson = { attempts?: number; last_attempt_run?: string; retried_at?: string } & Record<string, unknown>;

export const attemptsOf = (contact: ContactJson | null) => contact?.attempts ?? (contact?.retried_at ? 1 : 0);

/** Une tentative sur une fiche. Renvoie `true` si un email a été trouvé. */
export async function completeOne(
  db: Db,
  row: SignalCandidateRow,
  input: { deps: CompletionDeps; runId: string; now?: Date },
): Promise<{ found: boolean; email: string | null }> {
  const previous = (row.contact as ContactJson | null) ?? {};
  const contact = await input.deps.findContact(row.prospect_id!).catch(() => null);
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
    },
  });
  return { found: Boolean(contact?.email), email: contact?.email ?? null };
}

/**
 * Étape de complétion d'un run de préparation : les fiches « à compléter » de
 * TOUS les runs (30/09, 01/10 compris), dans le temps imparti.
 */
export async function runCompletionStage(
  db: Db,
  userId: string,
  runId: string,
  options: { deps: CompletionDeps; prefs?: Pick<FunnelPrefs, "preferredSectors" | "excludedSectors">; limit: number; deadline: number; now?: Date },
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

  let tried = 0;
  let found = 0;
  let refiltered = 0;
  for (const row of due) {
    if (tried >= options.limit || Date.now() > options.deadline) break;
    // Re-filtrée avec les règles du jour AVANT toute recherche payante.
    const verdict = filterSignal(rowToSignal(row), row.identity as unknown as Identity | null, { ...options.prefs, now: options.now });
    if (verdict.status === "rejeté") {
      await updateCandidate(db, row.id, { statut: "rejeté", motif_rejet: `re-filtré : ${verdict.reason}` });
      refiltered += 1;
      continue;
    }
    // Hunter bloqué et recherche gratuite déjà faite : on attend le retour des crédits.
    if (blocked && attemptsOf(row.contact as ContactJson | null) > 0) continue;
    tried += 1;
    if ((await completeOne(db, row, { deps: options.deps, runId, now: options.now })).found) found += 1;
  }
  return { due: due.length, tried, found, refiltered };
}
