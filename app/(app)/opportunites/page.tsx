import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Opportunity } from "@/lib/opportunities/types";
import { OpportunitiesClient } from "./_components/opportunities-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opportunités · ORION" };

/**
 * Opportunités des plateformes freelance (Codeur d'abord, Upwork ensuite).
 * V1 : saisie manuelle de l'annonce, analyse et proposition par l'IA, suivi.
 * Aucun envoi, aucune connexion aux plateformes, aucun scraping.
 */
export default async function OpportunitesPage({ searchParams }: { searchParams?: { id?: string } }) {
  await requireUser();
  const db = createClient() as unknown as { from: (table: string) => any };
  const { data } = await db.from("opportunities").select("*").order("created_at", { ascending: false }).limit(500);
  const opportunities = (data ?? []) as Opportunity[];
  return (
    <>
      <PageHeader
        title="Opportunités"
        description="Annonces Codeur, Upwork, ComeUp, Malt : analyse d'adéquation et proposition prête à copier. Rien n'est envoyé automatiquement."
      />
      <OpportunitiesClient initial={opportunities} focusId={searchParams?.id ?? null} />
    </>
  );
}
