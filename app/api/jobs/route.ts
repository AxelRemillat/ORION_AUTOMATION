import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { driveInBackground, missingSettings } from "@/lib/jobs/background";
import { createJob, hasClaimableJob, listActiveJobs, listProspectJobs, listRecentJobs } from "@/lib/jobs/store";
import { CREATE_JOB_SCHEMA } from "@/lib/jobs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Les étapes tournent dans cette invocation (waitUntil) : plafond du plan Hobby. */
export const maxDuration = 300;

/**
 * POST /api/jobs {type, target, params} → {id}
 *
 * Le job est mis en file et son exécution démarre en `waitUntil` : la réponse
 * part tout de suite, le travail continue même si l'onglet se ferme.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  // Sans la clé service_role, un job resterait « en file » pour toujours : on le
  // dit tout de suite, en clair, plutôt que de laisser une barre figée.
  if (missingSettings().includes("SUPABASE_SERVICE_ROLE")) {
    return NextResponse.json(
      { error: "Tâches de fond indisponibles : SUPABASE_SERVICE_ROLE absente sur Vercel." },
      { status: 503 },
    );
  }

  const parsed = CREATE_JOB_SCHEMA.safeParse(await readJson<unknown>(request));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const created = await createJob(session.supabase, parsed.data);
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 500 });

  // Le travail démarre ICI, en arrière-plan : il ne dépend ni de l'onglet, ni
  // du secret des ticks.
  driveInBackground(request, created.id);
  return NextResponse.json({ id: created.id }, { status: 201 });
}

/**
 * GET /api/jobs?active=1 → jobs en file ou en cours + terminés non vus.
 * GET /api/jobs?prospectId=… → les derniers jobs de mail de ce prospect.
 * GET /api/jobs          → les 20 derniers.
 *
 * L'écran sonde cette route : on en profite pour relancer la chaîne si un job
 * attend (tick perdu, pg_cron absent). Tant que l'app est ouverte, rien ne
 * reste bloqué, même sans filet de sécurité côté base.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const query = new URL(request.url).searchParams;
  const prospectId = query.get("prospectId");
  if (prospectId) return NextResponse.json({ jobs: await listProspectJobs(session.supabase, prospectId) });

  const active = query.get("active") === "1";
  const jobs = active ? await listActiveJobs(session.supabase) : await listRecentJobs(session.supabase);

  if (active && jobs.some((job) => job.status === "queued" || job.status === "running")) {
    if (await hasClaimableJob(session.supabase)) driveInBackground(request, null);
  }
  return NextResponse.json({ jobs });
}
