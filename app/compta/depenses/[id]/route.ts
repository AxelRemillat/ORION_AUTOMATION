import { NextResponse } from "next/server";
import { gardeCompta } from "@/lib/compta/acces";
import { depot } from "@/lib/compta/contexte";

export const dynamic = "force-dynamic";

/** Justificatif d'une dépense : lien signé de 5 minutes vers le bucket privé (jamais d'URL publique). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  await gardeCompta();
  const d = await depot();
  const depense = (await d.depenses()).find((x) => x.id === params.id);
  const lien = depense?.justificatif_chemin ? await d.lienJustificatif(depense.justificatif_chemin) : null;
  if (!lien) return new NextResponse("Justificatif indisponible", { status: 404 });
  return NextResponse.redirect(lien, 302);
}
