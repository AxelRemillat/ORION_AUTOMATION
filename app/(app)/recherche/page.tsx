import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
      {/*
        La recherche n a plus d onglet dans la barre : ce lien est la sortie.
        Il est au-dessus du titre, la ou on cherche un retour.
      */}
      <Link
        href="/aujourdhui"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Aujourd&apos;hui
      </Link>
      <PageHeader
        title="Recherche"
        description="Identifier des entreprises et repérer les signaux qui justifient une offre d'automatisation."
      />
      <RechercheClient />
    </>
  );
}
