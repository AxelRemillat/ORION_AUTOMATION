import { NextResponse } from "next/server";
import { gardeCompta } from "@/lib/compta/acces";
import { depot } from "@/lib/compta/contexte";
import { pdfPiece } from "@/lib/compta/pdf/piece";

export const dynamic = "force-dynamic";

/**
 * PDF d'une facture ou d'un avoir. Émise : coordonnées FIGÉES à l'émission (une adresse changée ensuite ne modifie pas
 * une facture déjà envoyée). Brouillon : aperçu avec les coordonnées actuelles, marqué « BROUILLON » à la place du numéro.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  await gardeCompta();
  const d = await depot();
  const [factures, parametres, clients] = await Promise.all([d.factures(), d.parametres(), d.clients()]);
  const f = factures.find((x) => x.id === params.id);
  const client = f && clients.find((c) => c.id === f.client_id);
  if (!f || !client) return new NextResponse("Facture introuvable", { status: 404 });
  const emetteur = f.emetteur ?? parametres ?? { nom: "", adresse: "", siret: "", email: null, telephone: null, iban: null };
  const origine = f.facture_origine_id ? (factures.find((x) => x.id === f.facture_origine_id)?.numero ?? null) : null;
  const octets = pdfPiece({ genre: "facture", facture: { ...f, emetteur, client: f.client ?? client }, origine });
  return new NextResponse(Buffer.from(octets), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${f.numero ?? "brouillon"}.pdf"`, "cache-control": "private, no-store" },
  });
}
