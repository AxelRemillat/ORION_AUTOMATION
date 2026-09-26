import { NextResponse } from "next/server";
import { latestRun, effectiveStatus, isStale, startRun } from "@/lib/search/runs";
import { hasLiveJobForRun } from "@/lib/jobs/store";
import { readJson, requireSession } from "@/app/api/prospects/_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ouverture et lecture d'un scan.
 *
 * La creation est SEPAREE du travail : l'ecran obtient un identifiant
 * immediatement, puis lance le scan sans l'attendre et suit la ligne par
 * sondage. Sans cette separation, la barre d'avancement n'apparaitrait qu'une
 * fois le scan fini — c'est-a-dire jamais au bon moment.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const criteria = (await readJson<Record<string, unknown>>(request)) ?? {};
  const created = await startRun(session.supabase, criteria);
  if ("error" in created) {
    return NextResponse.json({ error: created.error }, { status: 500 });
  }
  return NextResponse.json({ id: created.id });
}

/**
 * Le dernier scan, en cours ou termine.
 *
 * C'est ce qui rend les resultats persistants : au retour sur l'ecran, on
 * reaffiche soit la barre la ou elle en est, soit le dernier resultat — sans
 * avoir relance quoi que ce soit, donc sans redepenser un centime.
 */
export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const run = await latestRun(session.supabase);
  if (!run) return NextResponse.json({ run: null });

  // Un scan dont la fonction a ete coupee resterait « running » a vie : on le
  // presente comme interrompu plutot que d'afficher une barre figee. SAUF si
  // un job le porte encore (en file derriere trois autres, ou repris apres une
  // coupure) : il n'est pas mort, il attend son tour.
  if (isStale(run) && (await hasLiveJobForRun(session.supabase, run.id))) {
    return NextResponse.json({ run });
  }
  return NextResponse.json({ run: { ...run, status: effectiveStatus(run) } });
}
