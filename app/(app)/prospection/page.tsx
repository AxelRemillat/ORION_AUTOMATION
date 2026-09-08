import { Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ProspectionClient } from "./prospection-client";

export const metadata = { title: "Prospection · PROSPECT" };

/**
 * SECTION PROSPECTION — analyse IA d'un prospect, chiffrage du pain point,
 * puis rédaction d'un email personnalisé en mode SEMI-AUTO : l'utilisateur
 * relit et valide avant enregistrement du brouillon. L'envoi est hors périmètre.
 */
export default async function ProspectionPage() {
  const supabase = createClient();
  const { data: prospects, error } = await supabase
    .from("prospects")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        title="Prospection"
        description="Analyser un prospect, chiffrer son pain point et préparer l'email d'approche."
      />
      {error || !prospects?.length ? (
        <EmptyState
          icon={<Users />}
          title={error ? "Prospects indisponibles" : "Aucun prospect à travailler"}
          description={
            error
              ? error.message
              : "Commencez par en ajouter depuis la Recherche : ils apparaîtront ici."
          }
        />
      ) : (
        <ProspectionClient initialProspects={prospects} />
      )}
    </>
  );
}
