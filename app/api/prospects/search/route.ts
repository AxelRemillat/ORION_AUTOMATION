import { NextResponse } from "next/server";
import { clampAnalysisLimit, searchAndEnrich } from "@/lib/enrichment";
import { tranchesForBucket } from "@/lib/enrichment/naf";
import { readJson, requireSession } from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SearchBody {
  q?: string;
  /** Lettre de section NAF. */
  section?: string;
  /** Identifiant de tranche d'effectif (voir SIZE_BUCKETS). */
  size?: string;
  /** Ville, code postal ou département. */
  zone?: string;
  withSignals?: boolean;
  /** Plafond d'entreprises reellement enrichies (1-10). */
  limit?: number;
}

/** Mode A — recherche par critères sur l'annuaire public, puis enrichissement. */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = await readJson<SearchBody>(request);
  if (!body) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const outcome = await searchAndEnrich({
    q: body.q,
    section: body.section || undefined,
    tranches: tranchesForBucket(body.size),
    zone: body.zone,
    withSignals: body.withSignals !== false,
    // Borne cote serveur : le client ne peut pas faire exploser la facture.
    limit: clampAnalysisLimit(body.limit),
  });

  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: 422 });
  return NextResponse.json(outcome);
}
