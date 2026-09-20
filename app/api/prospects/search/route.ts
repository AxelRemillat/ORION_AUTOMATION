import { NextResponse } from "next/server";
import { clampAnalysisLimit, clampScanWidth, searchAndEnrich } from "@/lib/enrichment";
import { tranchesForBucket } from "@/lib/enrichment/naf";
import { readJson, requireSession } from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Le scan interroge Linkup pour chaque candidat, par vagues de six. Avec une
 * largeur de 18 et une source lente, on depasse largement le plafond par
 * defaut d'une route serverless : on l'allonge explicitement.
 */
export const maxDuration = 60;

interface SearchBody {
  q?: string;
  /** Lettre de section NAF. */
  section?: string;
  /** Identifiant de tranche d'effectif (voir SIZE_BUCKETS). */
  size?: string;
  /** Ville, code postal ou département. */
  zone?: string;
  /** Plafond d'enrichissements profonds — Pappers (1-10). */
  limit?: number;
  /** Largeur du scan Linkup (5-25). */
  scanWidth?: number;
}

/**
 * Mode A — recherche par criteres, en deux phases.
 *
 * Phase 1 : scan Linkup sur une liste elargie de l'annuaire public.
 * Phase 2 : Pappers uniquement sur les entreprises porteuses d'un signal.
 */
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
    // Bornes cote serveur : le client ne peut pas faire exploser la facture.
    limit: clampAnalysisLimit(body.limit),
    scanWidth: clampScanWidth(body.scanWidth),
  });

  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: 422 });
  return NextResponse.json(outcome);
}
