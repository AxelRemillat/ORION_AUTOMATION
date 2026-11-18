import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, PageHeader } from "@/components/ui";
import { Alerte, Montant, SousNav, StatutFacture } from "@/components/compta/elements";
import { FormAvoir, FormEncaissement } from "@/components/compta/formulaires-facture";
import { dateFr } from "@/lib/compta/calculs";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { MOYENS } from "@/lib/compta/recettes";
import { completerBrouillon, emettreFacture, supprimerBrouillon } from "../../actions";

export const metadata = { title: "Facture · Compta" };

export default async function FactureDetail({ params, searchParams }: { params: { id: string }; searchParams: { erreur?: string } }) {
  const d = await depot();
  const t = await chargerTout(d);
  const f = t.factures.find((x) => x.id === params.id);
  if (!f) notFound();
  const journal = await d.journal(f.id);
  const avoirs = t.factures.filter((a) => a.type === "avoir" && a.facture_origine_id === f.id);
  const encaissements = t.encaissements.filter((e) => e.facture_id === f.id);
  const origine = f.facture_origine_id ? t.factures.find((x) => x.id === f.facture_origine_id) : null;
  const avoirsEmis = avoirs.filter((a) => a.etat === "emise").reduce((s, a) => s + a.total, 0);
  const titre = f.type === "avoir" ? `Avoir ${f.numero ?? "(brouillon)"}` : f.numero ? `Facture ${f.numero}` : "Facture en brouillon";

  return (
    <>
      <PageHeader
        title={titre}
        description={`${f.client_nom} · ${f.objet}`}
        actions={
          <a href={`/compta/factures/${f.id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="outline">{f.etat === "emise" ? "PDF" : "Aperçu PDF"}</Button>
          </a>
        }
      />
      <SousNav actif="/compta/factures" />
      <Alerte erreur={searchParams.erreur} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 pt-5">
              <ul className="divide-y divide-line-soft">
                {f.lignes.map((l, i) => (
                  <li key={i} className="flex justify-between gap-4 py-2 text-sm">
                    <span>
                      {l.designation} <span className="font-data text-muted">× {String(l.quantite).replace(".", ",")}</span>
                    </span>
                    <Montant c={Math.round(l.quantite * l.prix_unitaire)} />
                  </li>
                ))}
              </ul>
              <p className="flex justify-between border-t border-line pt-3 font-medium">
                <span>{f.type === "avoir" ? "Montant de l'avoir" : "Net à payer"} (TVA non applicable, art. 293 B du CGI)</span>
                <Montant c={f.total} />
              </p>
              {origine && (
                <p className="text-sm">
                  Corrige la facture <Link className="font-data text-primary-ink underline" href={`/compta/factures/${origine.id}`}>{origine.numero}</Link>
                  {f.motif_avoir ? ` — ${f.motif_avoir}` : ""}
                </p>
              )}
            </CardContent>
          </Card>

          {f.type === "facture" && f.etat === "emise" && (
            <Card>
              <CardHeader>
                <CardTitle>Encaissements et avoirs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {encaissements.length + avoirs.length === 0 && <p className="text-muted">Rien d&apos;encaissé pour l&apos;instant.</p>}
                {encaissements.map((e) => (
                  <p key={e.id} className="flex justify-between">
                    <span>
                      <span className="font-data">{dateFr(e.date)}</span> · {MOYENS[e.moyen]}
                      {e.reference ? ` · ${e.reference}` : ""}
                    </span>
                    <Montant c={e.montant} />
                  </p>
                ))}
                {avoirs.map((a) => (
                  <p key={a.id} className="flex justify-between">
                    <Link className="text-primary-ink underline" href={`/compta/factures/${a.id}`}>Avoir {a.numero ?? "(brouillon)"}</Link>
                    <Montant c={-a.total} />
                  </p>
                ))}
                <p className="flex justify-between border-t border-line pt-2 font-medium">
                  <span>Reste dû</span>
                  <Montant c={f.reste} />
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                État <StatutFacture statut={f.statut} avoir={f.type === "avoir"} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {f.etat === "emise" ? (
                <>
                  <p>
                    Émise le <span className="font-data">{dateFr(f.date_emission!)}</span>
                    {f.echeance && (
                      <>
                        , échéance <span className="font-data">{dateFr(f.echeance)}</span>
                      </>
                    )}
                  </p>
                  <p className="text-[12.5px] text-muted">Une pièce émise n&apos;est plus modifiable ni supprimable. Pour la corriger : un avoir.</p>
                </>
              ) : (
                <>
                  <form action={completerBrouillon} className="space-y-3">
                    <input type="hidden" name="id" value={f.id} />
                    <div>
                      <Label htmlFor="date_prestation">Date ou période de la prestation</Label>
                      <Input id="date_prestation" name="date_prestation" defaultValue={f.date_prestation} required />
                    </div>
                    <div>
                      <Label htmlFor="echeance_jours">Paiement à (jours)</Label>
                      <Input id="echeance_jours" name="echeance_jours" inputMode="numeric" defaultValue={f.echeance_jours} />
                    </div>
                    <Button type="submit" variant="outline" size="sm">
                      Enregistrer
                    </Button>
                  </form>
                  <form action={emettreFacture}>
                    <input type="hidden" name="id" value={f.id} />
                    <Button type="submit">Émettre (attribue le numéro)</Button>
                  </form>
                  <form action={supprimerBrouillon}>
                    <input type="hidden" name="id" value={f.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Supprimer le brouillon
                    </Button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>

          {f.type === "facture" && f.etat === "emise" && f.reste > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Encaisser</CardTitle>
              </CardHeader>
              <CardContent>
                <FormEncaissement facture={f} jour={t.jour} />
              </CardContent>
            </Card>
          )}
          {f.type === "facture" && f.etat === "emise" && f.total - avoirsEmis > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Corriger par un avoir</CardTitle>
              </CardHeader>
              <CardContent>
                <FormAvoir factureId={f.id} plafond={f.total - avoirsEmis} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Journal</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-[12.5px] text-muted">
                {journal.map((j) => (
                  <li key={j.id}>
                    <span className="font-data">{new Date(j.quand).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</span> · {j.action}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
