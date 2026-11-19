import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { Chronologie } from "@/components/crm/chronologie";
import { FicheEntete } from "@/components/crm/fiche-entete";
import { FicheFormulaire } from "@/components/crm/fiche-formulaire";
import { depotCrm } from "@/lib/crm/depot";
import { aujourdhuiParis } from "@/lib/crm/logique";

export const dynamic = "force-dynamic";

/** Fiche commerce du CRM (Cowork #117) : en-tête d'action, chronologie, formulaire complet. */
export default async function FicheCommerce({ params }: { params: { id: string } }) {
  const depot = await depotCrm();
  const c = await depot.commerce(params.id);
  if (!c) notFound();
  const [evenements, offres] = await Promise.all([depot.evenements(c.id), depot.offres()]);
  const aujourdhui = aujourdhuiParis();
  return (
    <>
      <Link href="/crm" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronLeft className="size-4" aria-hidden />
        CRM
      </Link>
      <PageHeader title={c.nom} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start">
        <div className="grid gap-8">
          <FicheEntete c={c} offres={offres} aujourdhui={aujourdhui} />
          <Chronologie commerceId={c.id} evenements={evenements} aujourdhui={aujourdhui} />
        </div>
        <details open className="group rounded-2xl border border-line bg-surface p-4 shadow-mist lg:sticky lg:top-20">
          <summary className="cursor-pointer list-none font-display text-lg text-text">
            Détails de la fiche <span className="text-sm text-muted group-open:hidden">(ouvrir)</span>
          </summary>
          <div className="mt-4">
            <FicheFormulaire c={c} offres={offres} />
          </div>
        </details>
      </div>
    </>
  );
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const c = await (await depotCrm()).commerce(params.id).catch(() => null);
  return { title: c ? `${c.nom} · CRM` : "CRM" };
}
