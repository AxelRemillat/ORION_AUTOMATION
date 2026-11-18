import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label, PageHeader, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Alerte, Montant, SousNav } from "@/components/compta/elements";
import { dateFr } from "@/lib/compta/calculs";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { lignesLivre, MOYENS, type LigneRecette } from "@/lib/compta/recettes";
import { creerEncaissement } from "../actions";

export const metadata = { title: "Livre des recettes · Compta" };

export default async function RecettesPage({ searchParams }: { searchParams: { erreur?: string; annee?: string } }) {
  const t = await chargerTout(await depot());
  const annee = /^\d{4}$/.test(searchParams.annee ?? "") ? searchParams.annee! : t.jour.slice(0, 4);
  const lignes: LigneRecette[] = t.encaissements
    .filter((e) => e.date.startsWith(annee))
    .map((e) => ({ ...e, client_nom: t.nomClient(e.client_id), piece: t.factures.find((f) => f.id === e.facture_id)?.numero ?? null }));
  const total = lignes.reduce((s, e) => s + e.montant, 0);
  return (
    <>
      <PageHeader
        title="Livre des recettes"
        description="Obligatoire en micro-entreprise : chaque encaissement, dans l'ordre chronologique, avec le client, la nature, le montant et le mode de règlement."
        actions={
          <>
            <a href={`/compta/recettes/export?format=csv&annee=${annee}`}>
              <Button variant="outline">CSV</Button>
            </a>
            <a href={`/compta/recettes/export?format=pdf&annee=${annee}`} target="_blank" rel="noreferrer">
              <Button variant="outline">PDF</Button>
            </a>
          </>
        }
      />
      <SousNav actif="/compta/recettes" />
      <Alerte erreur={searchParams.erreur} />
      <p className="mb-3 text-sm text-muted">
        Année {annee} · total encaissé <Montant c={total} className="text-text" />
        {" · "}
        <Link className="underline" href={`/compta/recettes?annee=${Number(annee) - 1}`}>
          {Number(annee) - 1}
        </Link>
      </p>
      {lignes.length === 0 ? (
        <EmptyState title="Aucun encaissement cette année" description="Les paiements reçus s'enregistrent depuis la facture, ou ci-dessous." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Client</TH>
              <TH className="hidden md:table-cell">Nature</TH>
              <TH className="hidden sm:table-cell">Mode</TH>
              <TH className="hidden sm:table-cell">Pièce</TH>
              <TH className="text-right">Montant</TH>
            </TR>
          </THead>
          <TBody>
            {lignesLivre(lignes).map(({ ligne, sousTotal }, i) =>
              sousTotal ? (
                <TR key={`t${i}`} className="bg-surface-2/60">
                  <TD colSpan={5} className="text-right font-medium">
                    {sousTotal.libelle}
                  </TD>
                  <TD className="text-right font-medium">
                    <Montant c={sousTotal.montant} />
                  </TD>
                </TR>
              ) : (
                <TR key={ligne!.id}>
                  <TD className="font-data">{dateFr(ligne!.date)}</TD>
                  <TD>{ligne!.client_nom}</TD>
                  <TD className="hidden md:table-cell">{ligne!.nature}</TD>
                  <TD className={ligne!.moyen === "especes" ? "hidden font-medium sm:table-cell" : "hidden sm:table-cell"}>{MOYENS[ligne!.moyen]}</TD>
                  <TD className="hidden font-data sm:table-cell">{ligne!.piece ?? ligne!.reference ?? "—"}</TD>
                  <TD className="text-right">
                    <Montant c={ligne!.montant} />
                  </TD>
                </TR>
              ),
            )}
          </TBody>
        </Table>
      )}

      <Card className="mt-6 max-w-2xl">
        <CardHeader>
          <CardTitle>Encaissement sans facture</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={creerEncaissement} className="grid gap-3 sm:grid-cols-2">
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
              <Label htmlFor="nature">Nature</Label>
              <Input id="nature" name="nature" required />
            </div>
            <div>
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" defaultValue={t.jour} required />
            </div>
            <div>
              <Label htmlFor="montant">Montant (négatif = remboursement)</Label>
              <Input id="montant" name="montant" inputMode="decimal" required />
            </div>
            <div>
              <Label htmlFor="moyen">Mode de règlement</Label>
              <Select id="moyen" name="moyen" defaultValue="virement">
                {Object.entries(MOYENS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="reference">Pièce justificative</Label>
              <Input id="reference" name="reference" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary">
                Enregistrer
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
