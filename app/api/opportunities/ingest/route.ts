import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { waitUntil } from "@/lib/jobs/dispatch";
import { DEFAULT_DAILY_LLM_CAP, ingestOpportunity, parseIngestBody } from "@/lib/opportunities/ingest";
import { opportunityAsk } from "@/lib/opportunities/run";

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

/** Comparaison à temps constant, quelle que soit la longueur (empreintes de même taille). */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

/** Propriétaire des opportunités : variable dédiée, sinon l'unique compte de l'app. */
async function ownerOf(db: ReturnType<typeof createAdminClient>): Promise<string | null> {
  const configured = process.env.OPPORTUNITIES_USER_ID?.trim();
  if (configured) return configured;
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 2 });
  const users = data?.users ?? [];
  return users.length === 1 ? users[0].id : null;
}

function appUrl(request: Request): string {
  const configured = process.env.ORION_PUBLIC_URL?.trim() || process.env.JOBS_BASE_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
}

export async function POST(request: Request) {
  const expected = process.env.OPPORTUNITIES_INGEST_SECRET?.trim();
  const given = request.headers.get("x-ingest-secret")?.trim() ?? "";
  if (!expected || !given || !sameSecret(given, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = parseIngestBody(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const db = createAdminClient();
  const userId = await ownerOf(db);
  if (!userId) return NextResponse.json({ error: "Propriétaire introuvable : renseignez OPPORTUNITIES_USER_ID." }, { status: 500 });

  const cap = Number(process.env.OPPORTUNITIES_DAILY_LLM_CAP);
  try {
    const result = await ingestOpportunity(
      {
        db: db as unknown as { from: (table: string) => any },
        userId,
        ask: opportunityAsk(),
        baseUrl: appUrl(request),
        llmCap: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_DAILY_LLM_CAP,
        background: waitUntil,
      },
      parsed.value,
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ingestion impossible" }, { status: 500 });
  }
}
