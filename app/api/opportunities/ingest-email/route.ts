import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { waitUntil } from "@/lib/jobs/dispatch";
import { DEFAULT_DAILY_LLM_CAP } from "@/lib/opportunities/ingest";
import { ingestPlatformEmail } from "@/lib/opportunities/email/ingest-email";
import { parseInboundEmail } from "@/lib/opportunities/email/parse";
import { ingestAuthorized, opportunitiesOwner, publicAppUrl } from "@/lib/opportunities/ingest-auth";
import { opportunityAsk } from "@/lib/opportunities/run";
import { pushNtfy } from "@/lib/notify/ntfy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Comme /ingest : réponse en moins de 25 s, la proposition finit en arrière-plan (waitUntil). */
export const maxDuration = 60;

/**
 * E-MAILS DES PLATEFORMES (Upwork, Malt, ComeUp) — un e-mail par appel, poussé
 * par le workflow n8n Gmail dédié. Corps : {message_id, from, subject, text,
 * html, received_at}. Même authentification que /ingest : en-tête
 * `x-ingest-secret` égal à `OPPORTUNITIES_INGEST_SECRET`. Aucun envoi, aucune
 * candidature, aucune lecture des sites des plateformes.
 */
export async function POST(request: Request) {
  if (!ingestAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = parseInboundEmail(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const db = createAdminClient();
  const userId = await opportunitiesOwner(db);
  if (!userId) return NextResponse.json({ error: "Propriétaire introuvable : renseignez OPPORTUNITIES_USER_ID." }, { status: 500 });

  const cap = Number(process.env.OPPORTUNITIES_DAILY_LLM_CAP);
  try {
    const result = await ingestPlatformEmail(
      {
        db: db as unknown as { from: (table: string) => any },
        userId,
        ask: opportunityAsk(),
        baseUrl: publicAppUrl(request),
        llmCap: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_DAILY_LLM_CAP,
        background: waitUntil,
        notify: (notification) => pushNtfy(notification),
      },
      parsed.value,
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ingestion impossible" }, { status: 500 });
  }
}
