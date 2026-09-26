import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { baseUrl, kickTick } from "@/lib/jobs/dispatch";
import { createJob, hasClaimableJob, listActiveJobs, listRecentJobs } from "@/lib/jobs/store";
import { CREATE_JOB_SCHEMA } from "@/lib/jobs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs {type, target, params} → {id}
 *
 * Le job est mis en file, puis un tick est déclenché sans attendre : la
 * réponse part tout de suite, le travail continue même si l'onglet se ferme.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const parsed = CREATE_JOB_SCHEMA.safeParse(await readJson<unknown>(request));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const created = await createJob(session.supabase, parsed.data);
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 500 });

  kickTick(baseUrl(request), { jobId: created.id });
  return NextResponse.json({ id: created.id }, { status: 201 });
}

/**
 * GET /api/jobs?active=1 → jobs en file ou en cours + terminés non vus.
 * GET /api/jobs          → les 20 derniers.
 *
 * L'écran sonde cette route : on en profite pour relancer la chaîne si un job
 * attend (tick perdu, pg_cron absent). Tant que l'app est ouverte, rien ne
 * reste bloqué, même sans filet de sécurité côté base.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const active = new URL(request.url).searchParams.get("active") === "1";
  const jobs = active ? await listActiveJobs(session.supabase) : await listRecentJobs(session.supabase);

  if (active && jobs.some((job) => job.status === "queued" || job.status === "running")) {
    if (await hasClaimableJob(session.supabase)) kickTick(baseUrl(request), { fanout: 3 });
  }
  return NextResponse.json({ jobs });
}
