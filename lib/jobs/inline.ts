import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { baseUrl, kickTick } from "./dispatch";
import { HANDLERS } from "./handlers";
import { driveJob } from "./runner";
import { createJob } from "./store";
import type { CreateJobInput } from "./types";

/** Marge sous maxDuration (300 s) pour écrire la réponse. */
const INLINE_DEADLINE_MS = 285_000;

/**
 * Les routes de lancement historiques (/api/prospects/search, /signals,
 * /api/emails/generate) créent désormais un job, puis le pilotent elles-mêmes
 * pour rendre la même réponse qu'avant : les écrans actuels n'y voient rien.
 *
 * La différence est derrière : si l'onglet se ferme ou si la fonction est
 * coupée, le job reste en base et un tick le termine. Si trois jobs tournent
 * déjà, celui-ci attend son tour sans bloquer la requête (409 + `jobId`).
 */
export async function runJobInline(
  request: Request,
  userDb: unknown,
  input: CreateJobInput,
): Promise<NextResponse> {
  const created = await createJob(userDb, input);
  if ("error" in created) {
    return NextResponse.json({ error: `Tâche non créée : ${created.error}` }, { status: 500 });
  }
  const jobId = created.id;
  const headers = { "X-Job-Id": jobId };
  const base = baseUrl(request);

  const final = await driveJob(createAdminClient(), jobId, HANDLERS, INLINE_DEADLINE_MS, {
    returnIfQueued: true,
  });
  // Une place s'est peut-être libérée : on réveille la file.
  kickTick(base, {});

  if (!final || final.status === "queued" || final.status === "running") {
    if (final?.status === "queued") kickTick(base, { jobId });
    return NextResponse.json(
      {
        error:
          final?.status === "queued"
            ? "Trois tâches tournent déjà : celle-ci attend son tour et partira seule."
            : "La tâche continue en arrière-plan : son résultat apparaîtra dans la liste des tâches.",
        jobId,
      },
      { status: 409, headers },
    );
  }
  if (final.status === "done") {
    return NextResponse.json(final.state.response ?? { ok: true }, { headers });
  }
  if (final.status === "cancelled") {
    return NextResponse.json({ error: "Tâche annulée.", jobId }, { status: 409, headers });
  }
  const status = typeof final.state.httpStatus === "number" ? final.state.httpStatus : 500;
  // Certains refus portent des champs que l'écran doit lire (gating d'accroche :
  // `needsFeeding`, `canForce`). Ils voyagent dans l'état du job.
  const details =
    final.state.httpDetails && typeof final.state.httpDetails === "object"
      ? (final.state.httpDetails as Record<string, unknown>)
      : {};
  return NextResponse.json(
    { error: final.error ?? "Échec de la tâche.", jobId, ...details },
    { status, headers },
  );
}
