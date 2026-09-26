import { NextResponse } from "next/server";
import { readExcludedSectors, writeExcludedSectors } from "@/lib/signals/settings";
import { readJson, requireSession } from "../../prospects/_guard";

export const runtime = "nodejs";

/**
 * Réglages de recherche.
 *
 * `GET` rend la liste des secteurs exclus (créée aux valeurs par défaut à la
 * première visite), `PUT` la remplace. Il n'y a pas de `PATCH` : une liste se
 * remplace, et un ajout unitaire aurait ouvert la porte aux courses entre deux
 * onglets pour rien.
 */

export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;
  return NextResponse.json({ excludedSectors: await readExcludedSectors(session.supabase) });
}

interface Body {
  excludedSectors?: unknown[];
}

export async function PUT(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = (await readJson<Body>(request)) ?? {};
  if (!Array.isArray(body.excludedSectors)) {
    return NextResponse.json({ error: "Liste de secteurs attendue." }, { status: 422 });
  }

  const outcome = await writeExcludedSectors(session.supabase, body.excludedSectors);
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: 422 });
  return NextResponse.json({ excludedSectors: outcome.sectors });
}
