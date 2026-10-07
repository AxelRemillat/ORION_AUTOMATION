import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { waitUntil } from "@/lib/jobs/dispatch";
import { DEFAULT_DAILY_LLM_CAP } from "@/lib/opportunities/ingest";
import { ingestPlatformEmail, planPlatformEmail } from "@/lib/opportunities/email/ingest-email";
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
 *
 * MODE TEST : `"dry_run": true` dans le corps → l'analyse (plateforme, type,
 * statut prévu, fiche visée, alerte prévue) est renvoyée SANS rien écrire en
 * base, sans alerte et sans appel au modèle.
 */
export async function POST(request: Request) {
  if (!ingestAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseInboundEmail(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const db = createAdminClient();
  const userId = await opportunitiesOwner(db);
  if (!userId) return NextResponse.json({ error: "Propriétaire introuvable : renseignez OPPORTUNITIES_USER_ID." }, { status: 500 });

  if (raw?.dry_run === true) {
    try {
      return NextResponse.json(await planPlatformEmail({ db: db as unknown as { from: (table: string) => any }, userId, baseUrl: publicAppUrl(request) }, parsed.value));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "analyse impossible" }, { status: 500 });
    }
  }

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
