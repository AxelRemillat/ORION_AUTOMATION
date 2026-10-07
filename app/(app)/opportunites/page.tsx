import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Opportunity } from "@/lib/opportunities/types";
import type { OpportunityEmail } from "@/lib/opportunities/email/view";
import { OpportunitiesClient } from "./_components/opportunities-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opportunités · ORION" };

/**
 * Opportunités des plateformes freelance : veille Codeur (RSS), e-mails
 * Upwork, Malt et ComeUp (workflow n8n Gmail), annonces collées à la main.
 * Analyse et proposition par l'IA, suivi. Aucun envoi, aucune candidature,
 * aucune connexion aux plateformes, aucun scraping.
 */
export default async function OpportunitesPage({ searchParams }: { searchParams?: { id?: string; filtre?: string } }) {
  await requireUser();
  const db = createClient() as unknown as { from: (table: string) => any };
  const [{ data }, emails] = await Promise.all([
    db.from("opportunities").select("*").order("created_at", { ascending: false }).limit(500),
    // E-mails des plateformes : suivi des fiches et « à trier ». Table absente (migration pas encore passée) : rien.
    db
      .from("opportunity_emails")
      .select("id, platform, kind, subject, from_address, received_at, status, opportunity_id, excerpt")
      .order("received_at", { ascending: false })
      .limit(300)
      .then((result: { data: OpportunityEmail[] | null; error: unknown }) => (result.error ? [] : (result.data ?? [])))
      .catch(() => [] as OpportunityEmail[]),
  ]);
  const opportunities = (data ?? []) as Opportunity[];
  return (
    <>
      <PageHeader
        title="Opportunités"
        description="Codeur, Upwork, Malt, ComeUp : analyse d'adéquation et proposition prête à copier. Rien n'est envoyé automatiquement."
      />
      <OpportunitiesClient
        initial={opportunities}
        emails={emails as OpportunityEmail[]}
        focusId={searchParams?.id ?? null}
        initialFilter={searchParams?.filtre === "relances" || searchParams?.filtre === "a_trier" ? searchParams.filtre : null}
      />
    </>
  );
}
