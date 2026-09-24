import { NextResponse } from "next/server";
import { toProspectInsert } from "@/lib/enrichment";
import type { EnrichedCompany } from "@/lib/enrichment";
import { PROSPECT_SOURCES, type ProspectSource } from "@/types";
import { readJson, requireSession } from "./_guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
  company?: Partial<EnrichedCompany>;
  source?: ProspectSource;
}

/** Code Postgres d'une violation de contrainte d'unicité. */
const UNIQUE_VIOLATION = "23505";

/** Ajoute un résultat de recherche à la table `prospects` (RLS : user courant). */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = await readJson<CreateBody>(request);
  const company = body?.company;
  if (!company?.company_name) {
    return NextResponse.json({ error: "Entreprise manquante." }, { status: 400 });
  }

  const source: ProspectSource = PROSPECT_SOURCES.includes(body?.source as ProspectSource)
    ? (body!.source as ProspectSource)
    : "auto";

  const payload = toProspectInsert(
    {
      ...(company as EnrichedCompany),
      signals: company.signals ?? [],
      key_figures: company.key_figures ?? {},
    },
    source,
  );

  const { data, error } = await session.supabase
    .from("prospects")
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // On renvoie l'id de la fiche existante : l'ecran doit pouvoir y
      // conduire, pas se contenter d'annoncer un echec.
      const { data: existing } = await session.supabase
        .from("prospects")
        .select("id")
        .eq("siren", company.siren ?? "")
        .maybeSingle();

      return NextResponse.json(
        {
          error: `${company.company_name} est déjà dans ton portefeuille.`,
          prospectId: existing?.id ?? null,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: `Enregistrement impossible : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ prospect: data }, { status: 201 });
}
