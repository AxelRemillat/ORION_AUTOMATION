import { NextResponse } from "next/server";
import { clampAnalysisLimit, clampScanWidth, searchAndEnrich } from "@/lib/enrichment";
import { tranchesForBucket } from "@/lib/enrichment/naf";
import { knownSirens } from "@/lib/trash/exclusions";
import { readJson, requireSession } from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Le scan interroge Linkup pour chaque candidat, par vagues de six, et
 * enchaine desormais plusieurs lots jusqu'a l'objectif. Le plafond serverless
 * est donc pousse au maximum autorise.
 */
export const maxDuration = 300;

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
  /** Autorise le depassement jusqu'au plafond de 3x (defaut : oui). */
  goFurther?: boolean;
}

/**
 * Mode A — recherche par criteres, en deux phases.
 *
 * Phase 1 : scan Linkup sur une liste elargie de l'annuaire public, par lots,
 * jusqu'a l'objectif ou le plafond de cout.
 * Phase 2 : Pappers uniquement sur les entreprises porteuses d'un signal.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = await readJson<SearchBody>(request);
  if (!body) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  // L'exclusion est lue avant le scan : une lecture ratee ne doit pas faire
  // echouer la recherche, elle la rend seulement moins econome. Elle couvre
  // portefeuille (corbeille comprise), favoris, scans recents et SIREN exclus
  // apres suppression definitive (lib/trash/exclusions.ts).
  const exclude = await knownSirens(session.supabase).catch(() => new Set<string>());

  const outcome = await searchAndEnrich(
    {
      q: body.q,
      section: body.section || undefined,
      tranches: tranchesForBucket(body.size),
      zone: body.zone,
      // Bornes cote serveur : le client ne peut pas faire exploser la facture.
      limit: clampAnalysisLimit(body.limit),
      scanWidth: clampScanWidth(body.scanWidth),
      goFurther: body.goFurther !== false,
    },
    {
      exclude,
      onScanned: async (rows) => {
        if (!rows.length) return;
        await session.supabase
          .from("scan_history")
          .upsert(
            rows.map((row) => ({ ...row, scanned_at: new Date().toISOString() })),
            { onConflict: "user_id,siren" },
          );
      },
    },
  );

  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: 422 });
  return NextResponse.json(outcome);
}
