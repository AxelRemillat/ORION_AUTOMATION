import { Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { loadPortfolio } from "@/lib/trash/portfolio";
import { requireUser } from "@/lib/auth";
import { DeliverabilityBanner } from "./_components/deliverability-banner";
import { buildDeliverability } from "./_lib/deliverability";
import { buildSequence, type SequenceStep } from "./_lib/sequence";
import { ProspectionClient } from "./prospection-client";
import { loadOffer } from "@/lib/offer/read";

export const metadata = { title: "Prospection · ORION" };

/**
 * SECTION PROSPECTION — analyse IA d'un prospect, chiffrage du pain point,
 * puis rédaction d'un email personnalisé en mode SEMI-AUTO : l'utilisateur
 * relit et valide avant enregistrement du brouillon. L'envoi part du Suivi.
 */
export default async function ProspectionPage() {
  const user = await requireUser();
  const supabase = createClient();

  // L'offre pilote la signature, la preuve et la demande : le client en a
  // besoin pour afficher le brief, et pour signaler si elle est incomplete.
  const loadedOffer = await loadOffer(supabase, user.id);

  const { prospects, messages, reminders, error } = await loadPortfolio(
    supabase,
    ["messages", "reminders"],
    { orderBy: "created_at" },
  );

  // Séquence pré-calculée côté serveur : le client reçoit des états, pas des
  // corps de messages.
  const sequences: Record<string, SequenceStep[]> = {};
  for (const prospect of prospects) {
    sequences[prospect.id] = buildSequence(
      messages.filter((message) => message.prospect_id === prospect.id),
      reminders.filter((reminder) => reminder.prospect_id === prospect.id),
      prospect.status,
    );
  }

  return (
    <>
      <PageHeader
        title="Prospection"
        description="Analyser un prospect, chiffrer son pain point et préparer l'email d'approche."
      />

      <div className="mb-4">
        <DeliverabilityBanner data={buildDeliverability(messages)} />
      </div>

      {error || prospects.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={error ? "Prospects indisponibles" : "Aucun prospect à travailler"}
          description={
            error
              ? error
              : "Commencez par en ajouter depuis la Recherche : ils apparaîtront ici."
          }
        />
      ) : (
        <ProspectionClient
          initialProspects={prospects}
          sequences={sequences}
          offer={loadedOffer.offer}
          offerComplete={loadedOffer.complete}
        />
      )}
    </>
  );
}
