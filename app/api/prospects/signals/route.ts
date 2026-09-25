import { NextResponse } from "next/server";
import { clampAnalysisLimit } from "@/lib/enrichment/limits";
import { tranchesForBucket } from "@/lib/enrichment/naf";
import { knownSirens } from "@/lib/trash/exclusions";
import { finishRun, isStopRequested, saveProgress } from "@/lib/search/runs";
import { DEFAULT_SIGNAL_DAYS, searchBySignals, sourceStates } from "@/lib/signals";
import { readExcludedSectors } from "@/lib/signals/settings";
import { readJson, requireSession } from "../_guard";

export const runtime = "nodejs";

/**
 * Meme plafond que la recherche par criteres.
 *
 * Sans cette ligne, la route heritait du defaut (dix secondes) alors qu'une
 * recherche par signaux demande 35 a 45 secondes : elle aurait ete coupee en
 * production, la ou elle passe en local.
 */
export const maxDuration = 300;

/**
 * Mode « Signaux d'abord ».
 *
 * `GET` rend l'état des sources sans rien appeler : l'écran a besoin de savoir
 * dès son chargement qu'une source est à configurer, pour la griser au lieu de
 * la proposer puis d'échouer.
 *
 * `POST` lance la recherche. Même plomberie de suivi que le mode par critères
 * (`search_runs`), parce que c'est la même attente côté utilisateur.
 */

export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;
  // `sourceStates` ne lit que la PRÉSENCE des identifiants, jamais leur valeur.
  return NextResponse.json({ sources: sourceStates() });
}

interface SignalsBody {
  /** Numéro de département, seul filtre géographique des deux sources. */
  departement?: string;
  /** Identifiant de tranche d'effectif (`"petite"` = 10 à 49). */
  size?: string;
  /** Fenêtre d'antériorité en jours. */
  days?: number;
  limit?: number;
  runId?: string;
  /** Passe outre le ciblage pour cette recherche seulement. */
  includeExcluded?: boolean;
}

/** Deux chiffres, ou un département corse (`2A`, `2B`). */
const DEPARTEMENT = /^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$/i;

/** Borne la fenêtre : au-delà de 90 jours, ce n'est plus une actualité. */
function clampDays(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_SIGNAL_DAYS;
  return Math.max(7, Math.min(90, parsed));
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = (await readJson<SignalsBody>(request)) ?? {};
  const departement = body.departement?.trim().toUpperCase() ?? "";
  if (!DEPARTEMENT.test(departement)) {
    return NextResponse.json(
      { error: "Indiquez un numéro de département (par exemple 69)." },
      { status: 422 },
    );
  }

  const tranches = tranchesForBucket(body.size);
  if (!tranches.length) {
    return NextResponse.json({ error: "Choisissez une taille d'entreprise." }, { status: 422 });
  }

  const limit = clampAnalysisLimit(body.limit);
  const runId = typeof body.runId === "string" ? body.runId : null;
  const exclude = await knownSirens(session.supabase).catch(() => new Set<string>());
  const includeExcluded = body.includeExcluded === true;
  const excludedSectors = includeExcluded ? [] : await readExcludedSectors(session.supabase);

  const outcome = await searchBySignals(
    { departement, tranches, days: clampDays(body.days), limit },
    {
      exclude,
      excludedSectors,
      includeExcluded,
      ...(runId
        ? {
            shouldStop: () => isStopRequested(session.supabase, runId),
            // Phase 1 : lecture des sources et résolution d'identité. Gratuite,
            // donc la barre s'appuie dessus sans culpabilité.
            onProgress: ({ looked, found }) =>
              saveProgress(session.supabase, runId, {
                phase: "annuaire",
                pagesRead: looked,
                pagesPlanned: Math.max(looked, limit * 8),
                scanned: looked,
                withSignal: found,
                analysed: 0,
                analysedPlanned: limit,
                step: `Rapprochement des signaux · ${found} entreprise(s) en tranche`,
              }),
            onEnrich: ({ analysed, planned }) =>
              saveProgress(session.supabase, runId, {
                phase: "fiches",
                pagesRead: 1,
                pagesPlanned: 1,
                scanned: 0,
                withSignal: planned,
                analysed,
                analysedPlanned: planned,
                step: `Ouverture des fiches ${analysed}/${planned}`,
              }),
          }
        : {}),
    },
  );

  if (runId) {
    const stopped = await isStopRequested(session.supabase, runId);
    await finishRun(session.supabase, runId, {
      status: stopped ? "stopped" : "done",
      results: outcome.results,
      warnings: outcome.warnings,
      progress: {
        phase: "fiches",
        pagesRead: 1,
        pagesPlanned: 1,
        scanned: outcome.lookups,
        withSignal: outcome.signalsFound,
        analysed: outcome.analysed,
        analysedPlanned: outcome.analysed,
        step: stopped ? "Recherche arrêtée" : "Recherche terminée",
      },
    });
  }

  return NextResponse.json({ ...outcome, runId });
}
