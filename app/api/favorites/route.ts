import { NextResponse } from "next/server";
import type { EnrichedCompany } from "@/lib/enrichment";
import { readJson, requireSession } from "../prospects/_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Code Postgres d'une violation de contrainte d'unicite. */
const UNIQUE_VIOLATION = "23505";

/**
 * Favoris — entreprises deja enrichies, mises en reserve.
 *
 * Aucun appel externe ici, ni a l'ecriture ni a la lecture : on stocke et on
 * relit l'instantane produit par une recherche deja payee. C'est tout
 * l'interet de la fonctionnalite.
 */
export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { data, error } = await session.supabase
    .from("favorites")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: `Favoris illisibles : ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ favorites: data ?? [] });
}

interface CreateBody {
  company?: Partial<EnrichedCompany>;
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = await readJson<CreateBody>(request);
  const company = body?.company;
  if (!company?.company_name) {
    return NextResponse.json({ error: "Entreprise manquante." }, { status: 400 });
  }

  // On fige l'enrichissement tel quel : signaux avec leurs preuves, chiffres
  // cles, warnings. C'est ce qui permettra de prospecter sans re-payer.
  const snapshot = {
    ...company,
    signals: company.signals ?? [],
    key_figures: company.key_figures ?? {},
  };

  const { data, error } = await session.supabase
    .from("favorites")
    .insert({
      company_name: company.company_name,
      siren: company.siren ?? null,
      website: company.website ?? null,
      sector: company.sector ?? null,
      city: company.city ?? null,
      company: snapshot as unknown as Record<string, unknown>,
    })
    .select()
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: `${company.company_name} est déjà dans vos favoris.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: `Mise en favori impossible : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ favorite: data }, { status: 201 });
}
