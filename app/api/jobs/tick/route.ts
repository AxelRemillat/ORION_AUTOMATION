import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/trash/cron-auth";
import { baseUrl, clampFanout, dispatchTick, waitUntil, type TickBody } from "@/lib/jobs/dispatch";
import { drainJobs } from "@/lib/jobs/background";
import { hasClaimableJob } from "@/lib/jobs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Maximum du plan Hobby (Fluid compute) : une étape de scan peut s'en approcher. */
export const maxDuration = 300;

/**
 * POST /api/jobs/tick — fait avancer les jobs prenables, étape par étape.
 *
 * Le chemin normal n'en a pas besoin : POST /api/jobs exécute déjà les étapes
 * en `waitUntil`. Le tick sert de relève — quand une invocation arrive au bout
 * de ses 300 s, et chaque minute via pg_cron (`{"fanout":3}`) pour reprendre
 * un job coupé alors que plus aucun navigateur n'est ouvert. Protégé par
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
  // Rien de prenable : on répond sans rien lancer.
  if (!(await hasClaimableJob(admin))) return NextResponse.json({ idle: true });

  const jobId = typeof body.jobId === "string" ? body.jobId : null;
  waitUntil(
    (async () => {
      // Étapes du job désigné, puis du reste de la file, dans cette invocation.
      const pending = await drainJobs(admin, { jobId });
      if (pending) await dispatchTick(base, {});
    })(),
  );
  return NextResponse.json({ accepted: true, jobId }, { status: 202 });
}
