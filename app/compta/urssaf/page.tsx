import Link from "next/link";
import { Badge, Button, Card, CardContent, PageHeader } from "@/components/ui";
import { Alerte, Montant, SousNav } from "@/components/compta/elements";
import { dateFr } from "@/lib/compta/calculs";
import { COMPTA_CONFIG, MENTION_ESTIMATION, SOURCES } from "@/lib/compta/config";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { lignesUrssaf } from "@/lib/compta/tableau";
import { finAcre } from "@/lib/compta/urssaf";
import { marquerDeclare } from "../actions";

export const metadata = { title: "URSSAF · Compta" };

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;

export default async function UrssafPage({ searchParams }: { searchParams: { erreur?: string } }) {
  const t = await chargerTout(await depot());
  const lignes = lignesUrssaf(t.encaissements, t.declarations, t.parametres, t.jour).reverse();
  const debut = t.parametres?.date_debut_activite;
  return (
    <>
      <PageHeader title="À déclarer à l'URSSAF" description="Déclaration trimestrielle du chiffre d'affaires ENCAISSÉ (BNC), sur autoentrepreneur.urssaf.fr." />
      <SousNav actif="/compta/urssaf" />
      <Alerte erreur={searchParams.erreur} />
      <p className="mb-5 rounded-lg border border-cyan/25 bg-cyan/10 px-4 py-3 text-sm text-cyan-ink">
        {MENTION_ESTIMATION}. Taux BNC {pct(COMPTA_CONFIG.tauxCotisations)} + formation professionnelle {pct(COMPTA_CONFIG.tauxCfp)}
        {t.parametres?.acre && debut ? `, ACRE (${pct(COMPTA_CONFIG.tauxCotisations * COMPTA_CONFIG.facteurAcre)}) jusqu'au ${dateFr(finAcre(debut))}` : ""}.
      </p>
      {!debut ? (
        <p className="text-sm text-muted">
          Renseignez la date de début d&apos;activité dans <Link href="/compta/parametres" className="underline">Paramètres</Link>.
        </p>
      ) : (
        <div className="space-y-4">
          {lignes.map((l) => (
            <Card key={`${l.trimestre.annee}-${l.trimestre.trimestre}`}>
              <CardContent className="grid gap-4 pt-5 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="space-y-1.5 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-text">
                    {l.premiere ? "Première déclaration" : `T${l.trimestre.trimestre} ${l.trimestre.annee}`}
                    <span className="font-data text-muted">
                      {dateFr(l.debut)} → {dateFr(l.fin)}
                    </span>
                    {l.declaration ? (
                      <Badge tone="success">Déclaré le {dateFr(l.declaration.declare_le)}</Badge>
                    ) : l.enRetard ? (
                      <Badge tone="danger">Date limite dépassée</Badge>
                    ) : (
                      <Badge tone="warning">À déclarer</Badge>
                    )}
                  </p>
                  <p>
                    Date limite : <span className="font-data">{dateFr(l.limite)}</span>
                  </p>
                  <p>
                    CA encaissé : <Montant c={l.estimation.chiffreAffaires} className="font-medium" /> · cotisations estimées <Montant c={l.estimation.cotisations} /> ({pct(l.estimation.taux)}
                    {l.estimation.acre ? ", ACRE" : ""}) + CFP <Montant c={l.estimation.cfp} /> = <Montant c={l.estimation.total} className="font-medium" />
                  </p>
                  {l.declaration && <p className="text-muted">Montant déclaré : <Montant c={l.declaration.montant_declare} /></p>}
                </div>
                {!l.declaration && t.jour > l.fin && (
                  <form action={marquerDeclare}>
                    <input type="hidden" name="annee" value={l.trimestre.annee} />
                    <input type="hidden" name="trimestre" value={l.trimestre.trimestre} />
                    <input type="hidden" name="montant" value={l.estimation.chiffreAffaires} />
                    <Button type="submit" variant="secondary">
                      Marquer comme déclaré
                    </Button>
                  </form>
                )}
                {!l.declaration && t.jour <= l.fin && <p className="text-[12.5px] text-muted sm:text-right">Période en cours :<br />déclaration possible après le {dateFr(l.fin)}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-6 text-[12px] leading-relaxed text-faint">
        Sources : <a className="underline" href={SOURCES.tauxCotisations.url}>taux URSSAF</a> (mis à jour le {SOURCES.tauxCotisations.verifiee}) ·{" "}
        <a className="underline" href={SOURCES.statutUrssaf.url}>calendrier et premières déclarations</a> · <a className="underline" href={SOURCES.acre.url}>ACRE</a> (vérifié le {SOURCES.acre.verifiee}). Échéance un samedi, un dimanche ou un jour férié : reportée au jour ouvré suivant.
      </p>
    </>
  );
}
