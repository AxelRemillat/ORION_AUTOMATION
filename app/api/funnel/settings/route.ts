import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { cleanPrefs, readPrefs, writePrefs } from "@/lib/funnel/settings";

export const runtime = "nodejs";

/**
 * Réglages de l'entonnoir : zones, secteurs, fenêtre, plafond de creusage et
 * run quotidien (6 h, heure de Paris). `PUT` remplace ce qui est fourni et
 * valide ; le reste garde sa valeur.
 */

export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;
  return NextResponse.json({ prefs: await readPrefs(session.supabase, session.userId) });
}

export async function PUT(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = (await readJson<Record<string, unknown>>(request)) ?? {};
  const prefs = cleanPrefs(body, await readPrefs(session.supabase, session.userId));
  if (prefs.daily && !prefs.departements.length) {
    return NextResponse.json({ error: "Le run quotidien a besoin d'au moins un département." }, { status: 422 });
  }
  const outcome = await writePrefs(session.supabase, session.userId, prefs);
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: 422 });
  return NextResponse.json({ prefs });
}
