import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { markResultsSeen } from "@/lib/outbox/feed";

export const dynamic = "force-dynamic";

/** POST /api/outbox/seen `{ ids }` — les résultats annoncés ne reviennent plus. */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const body = await readJson<{ ids?: unknown }>(request);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
  await markResultsSeen(session.supabase, ids);
  return NextResponse.json({ ok: true });
}
