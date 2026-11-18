import Link from "next/link";
import { Button, Card, CardContent, Input, Label, PageHeader, Select, Textarea } from "@/components/ui";
import { Alerte, SaisieLignes, SousNav } from "@/components/compta/elements";
import { COMPTA_CONFIG } from "@/lib/compta/config";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { creerDevis } from "../../actions";

export const metadata = { title: "Nouveau devis · Compta" };

export default async function NouveauDevisPage({ searchParams }: { searchParams: { erreur?: string } }) {
  const t = await chargerTout(await depot());
  return (
    <>
      <PageHeader title="Nouveau devis" description="Le numéro D-AAAA-NNN est attribué à l'enregistrement." />
      <SousNav actif="/compta/devis" />
      <Alerte erreur={searchParams.erreur} />
      {t.clients.length === 0 ? (
        <p className="text-sm text-muted">
          Ajoutez d&apos;abord un client dans <Link href="/compta/clients" className="underline">Clients</Link>.
        </p>
      ) : (
        <Card className="max-w-2xl">
          <CardContent className="space-y-4 pt-5">
            <form action={creerDevis} className="space-y-4">
              <div>
                <Label htmlFor="client_id">Client</Label>
                <Select id="client_id" name="client_id" required>
                  {t.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="objet">Objet</Label>
                <Input id="objet" name="objet" placeholder="Site vitrine, refonte…" required />
              </div>
              <SaisieLignes />
              <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                <div>
                  <Label htmlFor="validite_jours">Validité (jours)</Label>
                  <Input id="validite_jours" name="validite_jours" inputMode="numeric" defaultValue={COMPTA_CONFIG.validiteDevisJours} />
                </div>
                <div>
                  <Label htmlFor="conditions">Conditions</Label>
                  <Textarea id="conditions" name="conditions" rows={2} placeholder="Acompte, délais, modalités…" />
                </div>
              </div>
              <Button type="submit">Enregistrer le devis</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
}
