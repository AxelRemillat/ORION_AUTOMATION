import { NextResponse } from "next/server";
import { runJobInline } from "@/lib/jobs/inline";
import { signalsLabel, signalsParamsError, type SignalsParams } from "@/lib/jobs/handlers/signals";
import { sourceStates } from "@/lib/signals";
import { readJson, requireSession } from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * Recherche par signaux : un job `search_signals` (lib/jobs/handlers/signals.ts),
 * créé puis piloté par la route pour rendre la même réponse qu'avant. Les
 * paramètres sont contrôlés ICI aussi, pour répondre 422 sans créer de job.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = (await readJson<SignalsParams>(request)) ?? {};
  const invalid = signalsParamsError(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 422 });

  const params: SignalsParams = {
    ...body,
    departement: body.departement?.trim().toUpperCase(),
    runId: typeof body.runId === "string" ? body.runId : undefined,
  };
  return runJobInline(request, session.supabase, {
    type: "search_signals",
    target: { label: signalsLabel(params) },
    params: params as Record<string, unknown>,
  });
}
