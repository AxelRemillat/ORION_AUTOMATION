import { NextResponse } from "next/server";
import { readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";
import { PROSPECT_CSV_COLUMNS, prospectsCsv } from "@/lib/settings/volumes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Export CSV des prospects — LECTURE SEULE (aucune écriture, aucune suppression).
 * Session de l'utilisateur : la RLS limite l'export à ses propres fiches ; la
 * corbeille est exclue.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });

  let data: Record<string, unknown>[];
  try {
    // Toutes les fiches, page par page : un export ne s'arrête pas à 1 000 lignes.
    data = await readAll<Record<string, unknown>>(() =>
      supabase.from("prospects").select(PROSPECT_CSV_COLUMNS.join(", ")).is("deleted_at", null).order("created_at", { ascending: false }).order("id"),
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "lecture impossible" }, { status: 500 });
  }

  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(prospectsCsv(data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orion-prospects-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
