import { NextResponse } from "next/server";
import { requireSession } from "@/app/api/prospects/_guard";
import { unseenResults, upcomingSends } from "@/lib/outbox/feed";

export const dynamic = "force-dynamic";

/**
 * GET /api/outbox — lu par la barre de navigation (toutes les 30 s) :
 * envois à venir (badge) et résultats d'envois programmés pas encore
 * annoncés (toast « parti » / « échoué »).
 */
export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const [upcoming, results] = await Promise.all([
    upcomingSends(session.supabase).catch(() => []),
    unseenResults(session.supabase).catch(() => []),
  ]);
  return NextResponse.json({ upcoming, results });
}
