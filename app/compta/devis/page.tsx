import Link from "next/link";
import { Button, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Montant, SousNav, StatutDevisBadge } from "@/components/compta/elements";
import { dateFr } from "@/lib/compta/calculs";
import { chargerTout, depot } from "@/lib/compta/contexte";

export const metadata = { title: "Devis · Compta" };

export default async function DevisPage() {
  const t = await chargerTout(await depot());
  return (
    <>
      <PageHeader
        title="Devis"
        description="Numérotés D-AAAA-NNN à la création ; un devis accepté devient une facture en un clic."
        actions={
          <Link href="/compta/devis/nouveau">
            <Button>Nouveau devis</Button>
          </Link>
        }
      />
      <SousNav actif="/compta/devis" />
      {t.devis.length === 0 ? (
        <EmptyState title="Aucun devis" description="Créez un premier devis : il sera numéroté automatiquement." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Numéro</TH>
              <TH>Client</TH>
              <TH className="hidden sm:table-cell">Date</TH>
              <TH className="text-right">Total</TH>
              <TH>Statut</TH>
            </TR>
          </THead>
          <TBody>
            {t.devis.map((d) => (
              <TR key={d.id}>
                <TD>
                  <Link href={`/compta/devis/${d.id}`} className="font-data text-primary-ink underline-offset-2 hover:underline">
                    {d.numero}
                  </Link>
                  <span className="block text-[12.5px] text-muted">{d.objet}</span>
                </TD>
                <TD>{t.nomClient(d.client_id)}</TD>
                <TD className="hidden font-data sm:table-cell">{dateFr(d.date)}</TD>
                <TD className="text-right">
                  <Montant c={d.total} />
                </TD>
                <TD>
                  <StatutDevisBadge statut={d.statut} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
