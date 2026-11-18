import Link from "next/link";
import { Button, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Montant, SousNav, StatutFacture } from "@/components/compta/elements";
import { dateFr } from "@/lib/compta/calculs";
import { chargerTout, depot } from "@/lib/compta/contexte";

export const metadata = { title: "Factures · Compta" };

export default async function FacturesPage() {
  const t = await chargerTout(await depot());
  const tri = [...t.factures].sort((a, b) => (a.etat !== b.etat ? (a.etat === "brouillon" ? -1 : 1) : (b.numero ?? "").localeCompare(a.numero ?? "")));
  return (
    <>
      <PageHeader
        title="Factures et avoirs"
        description="Numéro F-AAAA-NNN attribué à l'émission, sans trou. Une facture émise ne se modifie plus : on la corrige par un avoir."
        actions={
          <Link href="/compta/factures/nouvelle">
            <Button>Nouvelle facture</Button>
          </Link>
        }
      />
      <SousNav actif="/compta/factures" />
      {tri.length === 0 ? (
        <EmptyState title="Aucune facture" description="Créez une facture, ou transformez un devis accepté." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Numéro</TH>
              <TH>Client</TH>
              <TH className="hidden sm:table-cell">Émise le</TH>
              <TH className="text-right">Montant</TH>
              <TH className="hidden text-right sm:table-cell">Reste dû</TH>
              <TH>Statut</TH>
            </TR>
          </THead>
          <TBody>
            {tri.map((f) => (
              <TR key={f.id}>
                <TD>
                  <Link href={`/compta/factures/${f.id}`} className="font-data text-primary-ink underline-offset-2 hover:underline">
                    {f.numero ?? "Brouillon"}
                  </Link>
                  <span className="block text-[12.5px] text-muted">{f.objet}</span>
                </TD>
                <TD>{f.client_nom}</TD>
                <TD className="hidden font-data sm:table-cell">{f.date_emission ? dateFr(f.date_emission) : "—"}</TD>
                <TD className="text-right">
                  <Montant c={f.type === "avoir" ? -f.total : f.total} />
                </TD>
                <TD className="hidden text-right sm:table-cell">{f.type === "facture" && f.etat === "emise" ? <Montant c={f.reste} /> : "—"}</TD>
                <TD>
                  <StatutFacture statut={f.statut} avoir={f.type === "avoir"} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
