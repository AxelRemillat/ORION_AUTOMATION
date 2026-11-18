import { Button, Card, CardContent, Input, Label, PageHeader, Textarea } from "@/components/ui";
import { Alerte, SousNav } from "@/components/compta/elements";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { enregistrerParametres } from "../actions";

export const metadata = { title: "Paramètres · Compta" };

export default async function ParametresPage({ searchParams }: { searchParams: { erreur?: string; ok?: string } }) {
  const t = await chargerTout(await depot());
  const p = t.parametres;
  return (
    <>
      <PageHeader title="Paramètres" description="Coordonnées imprimées sur les devis et les factures. Une facture émise garde celles du jour de son émission." />
      <SousNav actif="/compta/parametres" />
      <Alerte erreur={searchParams.erreur} ok={searchParams.ok ? "Paramètres enregistrés." : undefined} />
      <Card className="max-w-2xl">
        <CardContent className="pt-5">
          <form action={enregistrerParametres} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="nom">Nom et prénom (la mention « EI » est ajoutée sur les pièces)</Label>
              <Input id="nom" name="nom" defaultValue={p?.nom ?? ""} required />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="adresse">Adresse</Label>
              <Textarea id="adresse" name="adresse" rows={2} defaultValue={p?.adresse ?? ""} required />
            </div>
            <div>
              <Label htmlFor="siret">SIRET</Label>
              <Input id="siret" name="siret" defaultValue={p?.siret ?? ""} required />
            </div>
            <div>
              <Label htmlFor="date_debut_activite">Début d&apos;activité</Label>
              <Input id="date_debut_activite" name="date_debut_activite" type="date" defaultValue={p?.date_debut_activite ?? ""} />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" defaultValue={p?.email ?? ""} />
            </div>
            <div>
              <Label htmlFor="telephone">Téléphone</Label>
              <Input id="telephone" name="telephone" defaultValue={p?.telephone ?? ""} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="iban">IBAN (imprimé sur les factures, facultatif)</Label>
              <Input id="iban" name="iban" defaultValue={p?.iban ?? ""} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="acre" defaultChecked={p?.acre ?? false} className="size-4 accent-primary" /> Bénéficiaire de l&apos;ACRE (taux réduit jusqu&apos;à la fin du 3e trimestre civil après le début d&apos;activité)
            </label>
            <div className="sm:col-span-2">
              <Button type="submit">Enregistrer</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
