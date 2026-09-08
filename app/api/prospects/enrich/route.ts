import { NextResponse } from "next/server";
import { resolveAndEnrich } from "@/lib/enrichment";
import { readJson, requireSession } from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EnrichBody {
  /** Nom d'entreprise, SIREN (9 chiffres) ou URL de site. */
  query?: string;
  withSignals?: boolean;
}

/** Mode B — ajout manuel : une saisie libre, résolue puis enrichie. */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = await readJson<EnrichBody>(request);
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json(
      { error: "Indiquez un nom d'entreprise, un SIREN ou une URL." },
      { status: 400 },
    );
  }

  const outcome = await resolveAndEnrich(query, { withSignals: body?.withSignals !== false });
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: 404 });
  return NextResponse.json(outcome);
}
