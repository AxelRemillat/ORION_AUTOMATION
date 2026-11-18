import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Alerte, Montant, SousNav } from "@/components/compta/elements";
import { dateFr } from "@/lib/compta/calculs";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { creerDepense } from "../actions";

export const metadata = { title: "Dépenses · Compta" };

export default async function DepensesPage({ searchParams }: { searchParams: { erreur?: string } }) {
  const t = await chargerTout(await depot());
  const total = t.depenses.filter((d) => d.date.startsWith(t.jour.slice(0, 4))).reduce((s, d) => s + d.montant, 0);
  return (
    <>
      <PageHeader title="Achats et dépenses" description="Registre pour votre suivi personnel, avec les justificatifs (accès réservé)." />
      <SousNav actif="/compta/depenses" />
      <Alerte erreur={searchParams.erreur} />
      <p className="mb-5 rounded-lg border border-warn/30 bg-warn/15 px-4 py-3 text-sm text-warn-ink">
        En micro-entreprise BNC, les dépenses ne sont pas déductibles : les cotisations portent sur le chiffre d&apos;affaires encaissé, sans retirer les frais. Ce registre ne change donc rien aux montants à déclarer.
      </p>
      <p className="mb-3 text-sm text-muted">
        Total {t.jour.slice(0, 4)} : <Montant c={total} className="text-text" />
      </p>
      {t.depenses.length === 0 ? (
        <EmptyState title="Aucune dépense" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Fournisseur</TH>
              <TH className="hidden sm:table-cell">Nature</TH>
              <TH className="text-right">Montant</TH>
              <TH>Justificatif</TH>
            </TR>
          </THead>
          <TBody>
            {t.depenses.map((d) => (
              <TR key={d.id}>
                <TD className="font-data">{dateFr(d.date)}</TD>
                <TD>{d.fournisseur}</TD>
                <TD className="hidden sm:table-cell">{d.nature}</TD>
                <TD className="text-right">
                  <Montant c={d.montant} />
                </TD>
                <TD>
                  {d.justificatif_chemin ? (
                    <a className="text-primary-ink underline" href={`/compta/depenses/${d.id}`} target="_blank" rel="noreferrer">
                      Ouvrir
                    </a>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Card className="mt-6 max-w-2xl">
        <CardHeader>
          <CardTitle>Nouvelle dépense</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={creerDepense} className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" defaultValue={t.jour} required />
            </div>
            <div>
              <Label htmlFor="montant">Montant TTC</Label>
              <Input id="montant" name="montant" inputMode="decimal" required />
            </div>
            <div>
              <Label htmlFor="fournisseur">Fournisseur</Label>
              <Input id="fournisseur" name="fournisseur" required />
            </div>
            <div>
              <Label htmlFor="nature">Nature</Label>
              <Input id="nature" name="nature" placeholder="Logiciel, matériel, déplacement…" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="justificatif">Justificatif (PDF ou image, 10 Mo au plus)</Label>
              <Input id="justificatif" name="justificatif" type="file" accept="application/pdf,image/*" />
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
