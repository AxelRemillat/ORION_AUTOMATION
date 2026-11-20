import Link from "next/link";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label, PageHeader, Table, TBody, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { Alerte, SousNav } from "@/components/compta/elements";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { creerClient } from "../actions";

export const metadata = { title: "Clients · Compta" };

export default async function ClientsPage({ searchParams }: { searchParams: { erreur?: string } }) {
  const t = await chargerTout(await depot());
  return (
    <>
      <PageHeader title="Clients facturés" description="Fiche minimale pour la facturation. Quand la fiche CRM existe, son identifiant peut y être rattaché." />
      <SousNav actif="/compta/clients" />
      <Alerte erreur={searchParams.erreur} />
      {t.clients.length === 0 ? (
        <EmptyState title="Aucun client" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Nom</TH>
              <TH>Type</TH>
              <TH className="hidden sm:table-cell">Adresse</TH>
              <TH className="hidden md:table-cell">SIREN</TH>
            </TR>
          </THead>
          <TBody>
            {t.clients.map((c) => (
              <TR key={c.id}>
                <TD>
                  {c.nom}
                  {c.crm_ref && (
                    <Link href={`/crm/${c.crm_ref}`} className="ml-2" title="Ouvrir la fiche CRM">
                      <Badge tone="info">CRM</Badge>
                    </Link>
                  )}
                </TD>
                <TD>{c.professionnel ? "Professionnel" : "Particulier"}</TD>
                <TD className="hidden whitespace-pre-line text-[13px] text-muted sm:table-cell">{c.adresse}</TD>
                <TD className="hidden font-data md:table-cell">{c.siren ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Card className="mt-6 max-w-2xl">
        <CardHeader>
          <CardTitle>Nouveau client</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={creerClient} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="nom">Nom ou raison sociale</Label>
              <Input id="nom" name="nom" required />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="adresse">Adresse (obligatoire pour un particulier)</Label>
              <Textarea id="adresse" name="adresse" rows={2} />
            </div>
            <div>
              <Label htmlFor="siren">SIREN (professionnel)</Label>
              <Input id="siren" name="siren" inputMode="numeric" />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div>
              <Label htmlFor="crm_ref">Identifiant de la fiche CRM (facultatif)</Label>
              <Input id="crm_ref" name="crm_ref" pattern="[0-9a-fA-F-]{36}" title="Identifiant (UUID) de la fiche CRM" />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="professionnel" defaultChecked className="size-4 accent-primary" /> Client professionnel (indemnité de 40 € sur ses factures)
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary">
                Ajouter
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
