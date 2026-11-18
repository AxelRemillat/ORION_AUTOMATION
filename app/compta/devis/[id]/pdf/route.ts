import { NextResponse } from "next/server";
import { gardeCompta } from "@/lib/compta/acces";
import { depot } from "@/lib/compta/contexte";
import { pdfPiece } from "@/lib/compta/pdf/piece";

export const dynamic = "force-dynamic";

/** PDF du devis (coordonnées actuelles de l'émetteur et du client : un devis n'est pas figé comme une facture). */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  await gardeCompta();
  const d = await depot();
  const [devis, parametres, clients] = await Promise.all([d.devis(), d.parametres(), d.clients()]);
  const devisTrouve = devis.find((x) => x.id === params.id);
  const client = devisTrouve && clients.find((c) => c.id === devisTrouve.client_id);
  if (!devisTrouve || !client) return new NextResponse("Devis introuvable", { status: 404 });
  const emetteur = parametres ?? { nom: "", adresse: "", siret: "", email: null, telephone: null, iban: null };
  const octets = pdfPiece({ genre: "devis", devis: devisTrouve, emetteur, client });
  return new NextResponse(Buffer.from(octets), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${devisTrouve.numero}.pdf"`, "cache-control": "private, no-store" },
  });
}
