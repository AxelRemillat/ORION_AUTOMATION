import Link from "next/link";
import { Button, Card, CardContent, Input, Label, PageHeader, Select } from "@/components/ui";
import { Alerte, SaisieLignes, SousNav } from "@/components/compta/elements";
import { COMPTA_CONFIG } from "@/lib/compta/config";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { creerFacture } from "../../actions";

export const metadata = { title: "Nouvelle facture · Compta" };

export default async function NouvelleFacturePage({ searchParams }: { searchParams: { erreur?: string } }) {
  const t = await chargerTout(await depot());
  return (
    <>
      <PageHeader title="Nouvelle facture" description="Enregistrée en brouillon, sans numéro. Le numéro est attribué à l'émission." />
      <SousNav actif="/compta/factures" />
      <Alerte erreur={searchParams.erreur} />
      {t.clients.length === 0 ? (
        <p className="text-sm text-muted">
          Ajoutez d&apos;abord un client dans <Link href="/compta/clients" className="underline">Clients</Link>.
        </p>
      ) : (
        <Card className="max-w-2xl">
          <CardContent className="pt-5">
            <form action={creerFacture} className="space-y-4">
              <div>
                <Label htmlFor="client_id">Client</Label>
                <Select id="client_id" name="client_id" required>
                  {t.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                      {c.professionnel ? "" : " (particulier)"}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="objet">Objet</Label>
                <Input id="objet" name="objet" required />
              </div>
              <SaisieLignes />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="date_prestation">Date ou période de la prestation</Label>
                  <Input id="date_prestation" name="date_prestation" placeholder="novembre 2026" required />
                </div>
                <div>
                  <Label htmlFor="echeance_jours">Paiement à (jours, 60 au plus)</Label>
                  <Input id="echeance_jours" name="echeance_jours" inputMode="numeric" defaultValue={COMPTA_CONFIG.echeanceJours} />
                </div>
              </div>
              <Button type="submit">Enregistrer le brouillon</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
}
