import { NextResponse } from "next/server";
import { requireSession } from "@/app/api/prospects/_guard";
import { missingSettings } from "@/lib/jobs/background";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/health — ce qui manque pour que les jobs tournent.
 *
 * Rend des NOMS de variables, jamais leur valeur : de quoi savoir d'un coup
 * d'œil quoi poser sur Vercel, sans rien exposer.
 */
export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const missing = missingSettings();
  return NextResponse.json({
    ok: !missing.includes("SUPABASE_SERVICE_ROLE"),
    missing,
    notes: {
      SUPABASE_SERVICE_ROLE: "indispensable : exécute les étapes des jobs",
      JOBS_TICK_SECRET: "relève par /api/jobs/tick et pg_cron quand l'app est fermée",
    },
  });
}
