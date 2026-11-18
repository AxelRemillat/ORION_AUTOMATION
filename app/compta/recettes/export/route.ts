import { NextResponse, type NextRequest } from "next/server";
import { gardeCompta } from "@/lib/compta/acces";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { nomEi } from "@/lib/compta/pdf/piece";
import { csvLivre, pdfLivre, type LigneRecette } from "@/lib/compta/recettes";

export const dynamic = "force-dynamic";

/** Export du livre des recettes d'une année : ?format=csv|pdf&annee=AAAA. */
export async function GET(req: NextRequest) {
  await gardeCompta();
  const t = await chargerTout(await depot());
  const annee = /^\d{4}$/.test(req.nextUrl.searchParams.get("annee") ?? "") ? req.nextUrl.searchParams.get("annee")! : t.jour.slice(0, 4);
  const lignes: LigneRecette[] = t.encaissements
    .filter((e) => e.date.startsWith(annee))
    .map((e) => ({ ...e, client_nom: t.nomClient(e.client_id), piece: t.factures.find((f) => f.id === e.facture_id)?.numero ?? null }));
  const nom = `livre-des-recettes-${annee}`;
  const entetes = { "cache-control": "private, no-store" };
  if (req.nextUrl.searchParams.get("format") === "pdf") {
    const octets = pdfLivre(lignes, nomEi(t.parametres?.nom || "Titulaire"), annee);
    return new NextResponse(Buffer.from(octets), { headers: { ...entetes, "content-type": "application/pdf", "content-disposition": `inline; filename="${nom}.pdf"` } });
  }
  return new NextResponse(csvLivre(lignes), { headers: { ...entetes, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${nom}.csv"` } });
}
