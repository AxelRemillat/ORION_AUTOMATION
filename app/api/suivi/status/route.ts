import { NextResponse } from "next/server";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/types";
import { writeProspectStatus } from "@/app/(app)/suivi/_lib/write-status";
import { readJson, requireSession } from "@/app/api/prospects/_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Déplacement d'une carte du Kanban (/suivi).
 *
 * Route plutôt qu'action serveur, pour deux raisons de latence :
 *   - une action qui appelle `revalidatePath` renvoie le rendu COMPLET de la
 *     page courante (loadPortfolio : quatre tables) ; ici rien n'est revalidé,
 *     l'écran est déjà à jour de façon optimiste ;
 *   - Next exécute les actions serveur une par une ; deux cartes déplacées
 *     coup sur coup attendaient l'une après l'autre.
 */
export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = await readJson<{ id?: unknown; status?: unknown }>(request);
  const id = typeof body?.id === "string" ? body.id : "";
  const status = body?.status;
  if (!id || !PROSPECT_STATUSES.includes(status as ProspectStatus)) {
    return NextResponse.json({ error: "Prospect ou statut invalide." }, { status: 400 });
  }

  const result = await writeProspectStatus(session.supabase, id, status as ProspectStatus);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 500 });
  }
  return NextResponse.json({ ok: true });
}
