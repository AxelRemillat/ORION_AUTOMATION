import { PageHeader } from "@/components/ui";
import { CrmClient } from "@/components/crm/crm-client";
import { depotCrm } from "@/lib/crm/depot";
import { aujourdhuiParis } from "@/lib/crm/logique";

export const dynamic = "force-dynamic";
export const metadata = { title: "CRM" };

/**
 * CRM du Web des Artisans (Cowork #117) : les commerces prospectés et les clients, en tableau ou en kanban.
 * `?nouveau=1` ouvre directement la création rapide (raccourci depuis le téléphone).
 */
export default async function CrmPage({ searchParams }: { searchParams: { nouveau?: string } }) {
  const commerces = await (await depotCrm()).commerces();
  return (
    <>
      <PageHeader title="CRM" description="Commerces prospectés et clients du Web des Artisans." />
      <CrmClient commerces={commerces} aujourdhui={aujourdhuiParis()} nouveauOuvert={searchParams.nouveau === "1"} />
    </>
  );
}
