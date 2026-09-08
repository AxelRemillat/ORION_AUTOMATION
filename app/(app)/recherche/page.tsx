import { PageHeader } from "@/components/ui";
import { RechercheClient } from "./recherche-client";

export const metadata = { title: "Recherche · PROSPECT" };

/**
 * SECTION RECHERCHE — deux modes d'acquisition :
 * A) critères (annuaire public + enrichissement), B) saisie libre.
 * Toute la logique est côté client : les appels tiers passent par
 * /api/prospects/search et /api/prospects/enrich.
 */
export default function RecherchePage() {
  return (
    <>
      <PageHeader
        title="Recherche"
        description="Identifier des entreprises et repérer les signaux qui justifient une offre d'automatisation."
      />
      <RechercheClient />
    </>
  );
}
