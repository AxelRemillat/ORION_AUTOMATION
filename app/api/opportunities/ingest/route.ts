import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { waitUntil } from "@/lib/jobs/dispatch";
import { DEFAULT_DAILY_LLM_CAP, ingestOpportunity, parseIngestBody } from "@/lib/opportunities/ingest";
import { opportunityAsk } from "@/lib/opportunities/run";
import { pushNtfy } from "@/lib/notify/ntfy";
import { runAlertCatchUp } from "@/lib/opportunities/rattrapage-alertes";
import { pushOpportunityAlert } from "@/lib/push/events";
import type { Db } from "@/lib/trash/scope";
import { ingestAuthorized, opportunitiesOwner, publicAppUrl } from "@/lib/opportunities/ingest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** La réponse part en moins de 25 s ; la proposition finit en arrière-plan (waitUntil). */
export const maxDuration = 60;

/**
 * VEILLE CODEUR — reçoit un item du flux RSS officiel de Codeur, poussé par le
 * workflow n8n dédié. Authentification : en-tête `x-ingest-secret` égal à
 * `OPPORTUNITIES_INGEST_SECRET` (comparaison à temps constant). Aucun envoi,
 * aucune lecture des pages Codeur.
 */

export async function POST(request: Request) {
  if (!ingestAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = parseIngestBody(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const db = createAdminClient();
  const userId = await opportunitiesOwner(db);
  if (!userId) return NextResponse.json({ error: "Propriétaire introuvable : renseignez OPPORTUNITIES_USER_ID." }, { status: 500 });

  const cap = Number(process.env.OPPORTUNITIES_DAILY_LLM_CAP);
  const deps = {
    db: db as unknown as { from: (table: string) => any },
    userId,
    ask: opportunityAsk(),
    baseUrl: publicAppUrl(request),
    llmCap: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_DAILY_LLM_CAP,
    background: waitUntil,
    notify: (notification: Parameters<typeof pushNtfy>[0]) => pushNtfy(notification),
    // Notification PC (Web Push) quand une offre passe en Alerte (Cowork #28).
    onAlert: (id: string) => pushOpportunityAlert(db as unknown as Db, userId, id),
  };
  try {
    const result = await ingestOpportunity(deps, parsed.value);
    // Rattrapage unique des alertes ratées (Cowork #27), en arrière-plan, verrouillé en base.
    waitUntil(runAlertCatchUp(deps).catch(() => null));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ingestion impossible" }, { status: 500 });
  }
}
