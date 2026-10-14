import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { demoVisitAuthorized } from "@/lib/demo-visits/auth";
import { parseVisit } from "@/lib/demo-visits/model";
import { recordDemoVisit } from "@/lib/demo-visits/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DÉMOS OUVERTES DEPUIS LES MAILS (Cowork #34) — appelée par le portfolio,
 * côté serveur, jamais par un navigateur.
 *
 * En-tête `x-demo-visits-secret` égal à DEMO_VISITS_SECRET (temps constant).
 * Corps : { demo, v, type } ; tout le reste est ignoré. Le jour est celui du
 * serveur ORION. Seul un compteur est incrémenté : rien de personnel n'est lu
 * ni gardé (ni IP, ni user-agent, ni identifiant).
 */
export async function POST(request: Request) {
  if (!demoVisitAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const visit = parseVisit(await request.json().catch(() => null));
  if (!visit) return NextResponse.json({ error: "visite invalide" }, { status: 400 });

  const saved = await recordDemoVisit(createAdminClient(), visit).catch(() => false);
  return NextResponse.json({ ok: saved }, { status: saved ? 200 : 500 });
}
