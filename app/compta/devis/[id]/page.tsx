import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { Alerte, Montant, SousNav, StatutDevisBadge } from "@/components/compta/elements";
import { ajouterJours, dateFr } from "@/lib/compta/calculs";
import { chargerTout, depot } from "@/lib/compta/contexte";
import type { StatutDevis } from "@/lib/compta/types";
import { changerStatutDevis, devisEnFacture } from "../../actions";

export const metadata = { title: "Devis · Compta" };

const SUIVANTS: Record<StatutDevis, [StatutDevis, string][]> = {
  brouillon: [["envoye", "Marquer envoyé"]],
  envoye: [["accepte", "Accepté"], ["refuse", "Refusé"]],
  accepte: [],
  refuse: [["envoye", "Renvoyé"]],
};

export default async function DevisDetail({ params, searchParams }: { params: { id: string }; searchParams: { erreur?: string } }) {
  const t = await chargerTout(await depot());
  const d = t.devis.find((x) => x.id === params.id);
  if (!d) notFound();
  const facture = d.facture_id ? t.factures.find((f) => f.id === d.facture_id) : null;
  return (
    <>
      <PageHeader
        title={`Devis ${d.numero}`}
        description={`${t.nomClient(d.client_id)} · ${d.objet}`}
        actions={
          <a href={`/compta/devis/${d.id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="outline">PDF</Button>
          </a>
        }
      />
      <SousNav actif="/compta/devis" />
      <Alerte erreur={searchParams.erreur} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardContent className="space-y-3 pt-5">
            <ul className="divide-y divide-line-soft">
              {d.lignes.map((l, i) => (
                <li key={i} className="flex justify-between gap-4 py-2 text-sm">
                  <span>
                    {l.designation} <span className="font-data text-muted">× {String(l.quantite).replace(".", ",")}</span>
                  </span>
                  <Montant c={Math.round(l.quantite * l.prix_unitaire)} />
                </li>
              ))}
            </ul>
            <p className="flex justify-between border-t border-line pt-3 font-medium">
              <span>Total (TVA non applicable)</span>
              <Montant c={d.total} />
            </p>
            {d.conditions && <p className="text-[13px] text-muted">Conditions : {d.conditions}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Suivi <StatutDevisBadge statut={d.statut} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Du <span className="font-data">{dateFr(d.date)}</span>, valable jusqu&apos;au <span className="font-data">{dateFr(ajouterJours(d.date, d.validite_jours))}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {SUIVANTS[d.statut].map(([statut, libelle]) => (
                <form key={statut} action={changerStatutDevis}>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="statut" value={statut} />
                  <Button type="submit" variant="outline" size="sm">
                    {libelle}
                  </Button>
                </form>
              ))}
            </div>
            {facture ? (
              <p>
                Facture : <Link className="font-data text-primary-ink underline" href={`/compta/factures/${facture.id}`}>{facture.numero ?? "brouillon"}</Link>
              </p>
            ) : (
              d.statut !== "refuse" && (
                <form action={devisEnFacture}>
                  <input type="hidden" name="id" value={d.id} />
                  <Button type="submit">Transformer en facture</Button>
                </form>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
