import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/trash/cron-auth";
import { purgeExpired } from "@/lib/trash/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Purge quotidienne de la corbeille (vercel.json → crons).
 *
 * Supprime définitivement, pour TOUS les comptes (client service_role), les
 * prospects à la corbeille depuis plus de 14 jours, avec leurs données liées,
 * et exclut leur SIREN de la recherche. Idempotente : relancée, elle ne purge
 * que ce qui reste à purger.
 */
export async function GET(request: Request) {
  if (!authorizeCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const result = await purgeExpired(createAdminClient());
  if (!result.ok) {
    console.error(`[purge-trash] échec : ${result.error}`);
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  console.log(`[purge-trash] ${result.count} prospect(s) supprimé(s) définitivement`);
  return NextResponse.json({ ok: true, purged: result.count });
}
