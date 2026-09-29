import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { runPreflight, type PreflightRequest } from "@/lib/mail-preflight/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mail-preflight → contrôle avant envoi d'un brouillon, avec la
 * signature du compte, les adresses trouvées du prospect et, sur demande, le
 * verdict « objet cohérent avec le corps » (LLM, mis en cache).
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const body = (await readJson<PreflightRequest>(request)) ?? ({} as PreflightRequest);
  if (typeof body.body !== "string" || typeof body.subject !== "string") {
    return NextResponse.json({ error: "Objet et corps attendus." }, { status: 400 });
  }
  return NextResponse.json(await runPreflight(session.supabase, session.userId, body));
}
