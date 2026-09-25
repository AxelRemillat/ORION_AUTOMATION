import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clampAnalysisLimit, clampScanWidth, searchAndEnrich } from "@/lib/enrichment";
import { tranchesForBucket } from "@/lib/enrichment/naf";
import type { Database } from "@/types";
import { readJson, requireSession } from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Le scan interroge Linkup pour chaque candidat, par vagues de six, et
 * enchaine desormais plusieurs lots jusqu'a l'objectif. Le plafond serverless
 * est donc pousse au maximum autorise.
 */
export const maxDuration = 300;

/** Fenetre pendant laquelle une entreprise deja scannee n'est pas repassee. */
const SCAN_MEMORY_DAYS = 30;

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
 * SIREN a ne pas rescanner.
 *
 * Trois sources : le portefeuille, les favoris, et la memoire de scan des 30
 * derniers jours. Sans cette exclusion, chaque recherche repayait Linkup pour
 * les memes entreprises — c'est la cause directe du « toujours les memes
 * entreprises lyonnaises ».
 */
async function knownSirens(supabase: SupabaseClient<Database>): Promise<Set<string>> {
  const since = new Date(Date.now() - SCAN_MEMORY_DAYS * 86_400_000).toISOString();

  const [prospects, favorites, scans] = await Promise.all([
    supabase.from("prospects").select("siren"),
    supabase.from("favorites").select("siren"),
    supabase.from("scan_history").select("siren").gte("scanned_at", since),
  ]);

  const known = new Set<string>();
  for (const rows of [prospects.data, favorites.data, scans.data]) {
    for (const row of rows ?? []) {
      const siren = (row as { siren: string | null }).siren;
      if (siren) known.add(siren);
    }
  }
  return known;
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
  // echouer la recherche, elle la rend seulement moins econome.
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
