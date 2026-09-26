import { NextResponse } from "next/server";
import { requestStop } from "@/lib/search/runs";
import { requireSession } from "@/app/api/prospects/_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * « Arreter » — on pose un drapeau, on ne tue rien.
 *
 * Le scan le relit ENTRE deux lots : couper au milieu d'un lot gacherait des
 * appels Linkup deja payes. L'arret est donc rapide, pas instantane.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  // La RLS restreint deja a l'utilisateur courant : inutile de re-verifier.
  await requestStop(session.supabase, params.id);
  return NextResponse.json({ ok: true });
}
