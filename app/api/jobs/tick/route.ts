import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/trash/cron-auth";
import { baseUrl, clampFanout, dispatchTick, waitUntil, type TickBody } from "@/lib/jobs/dispatch";
import { HANDLERS } from "@/lib/jobs/handlers";
import { runClaimedStep } from "@/lib/jobs/runner";
import { claimJob } from "@/lib/jobs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Maximum du plan Hobby (Fluid compute) : une étape de scan peut s'en approcher. */
export const maxDuration = 300;

/**
 * POST /api/jobs/tick — fait avancer UN job d'UNE étape.
 *
 * Appelé par la chaîne de ticks (chaque étape déclenche la suivante), par
 * POST /api/jobs, et chaque minute par pg_cron (`{"fanout":3}`). Protégé par
 * `Authorization: Bearer <JOBS_TICK_SECRET>`, comparé à temps constant.
 *
 * Réponse immédiate (202) : l'étape tourne en `waitUntil`, l'appelant n'attend
 * que l'accusé de réception.
 */
export async function POST(request: Request) {
  if (!authorizeCron(request.headers.get("authorization"), process.env.JOBS_TICK_SECRET)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  let body: TickBody = {};
  try {
    body = ((await request.json()) as TickBody) ?? {};
  } catch {
    // Corps vide : tick générique.
  }
  const base = baseUrl(request);

  // Réveil par le cron : autant de ticks que de jobs pouvant avancer en parallèle.
  const fanout = clampFanout(body.fanout);
  if (fanout) {
    waitUntil(Promise.all(Array.from({ length: fanout }, () => dispatchTick(base, {}))));
    return NextResponse.json({ dispatched: fanout }, { status: 202 });
  }

  const admin = createAdminClient();
  const job = await claimJob(admin, typeof body.jobId === "string" ? body.jobId : null);
  if (!job) return NextResponse.json({ idle: true });

  waitUntil(
    (async () => {
      const verdict = await runClaimedStep(admin, job, HANDLERS);
      // Étape suivante du même job, ou, s'il est clos, le prochain de la file.
      const next = verdict === "continue" || verdict === "retry" ? { jobId: job.id } : {};
      await dispatchTick(base, next);
    })(),
  );
  return NextResponse.json({ jobId: job.id, step: job.step }, { status: 202 });
}
