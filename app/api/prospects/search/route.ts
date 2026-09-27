import { NextResponse } from "next/server";
import { runJobInline } from "@/lib/jobs/inline";
import { searchLabel, type SearchParams } from "@/lib/jobs/handlers/search";
import { readJson, requireSession } from "../_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Le scan interroge Linkup pour chaque candidat, par vagues de six, et
 * enchaine plusieurs lots jusqu'a l'objectif : plafond du plan Hobby.
 */
export const maxDuration = 300;

/**
 * Mode A — recherche par criteres, en deux phases (lib/jobs/handlers/search.ts).
 *
 * La recherche est un job `search_criteria` : la route le cree puis le pilote
 * pour rendre la meme reponse qu'avant. Si l'utilisateur quitte la page, le
 * job continue cote serveur et ses resultats arrivent dans `search_runs`.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = await readJson<SearchParams>(request);
  if (!body) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const params: SearchParams = {
    ...body,
    runId: typeof body.runId === "string" ? body.runId : undefined,
  };
  return runJobInline(request, session.supabase, {
    type: "search_criteria",
    target: { label: searchLabel(params) },
    params: params as Record<string, unknown>,
  });
}
