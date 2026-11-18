import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, PageHeader, StatCard } from "@/components/ui";
import { Jauge, Montant, SousNav, StatutFacture } from "@/components/compta/elements";
import { dateFr, euros } from "@/lib/compta/calculs";
import { MENTION_ESTIMATION } from "@/lib/compta/config";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { synthese } from "@/lib/compta/tableau";

export const metadata = { title: "Compta · ORION" };

/** Tableau de bord Compta : CA encaissé, impayés, prochaine échéance URSSAF, seuils. */
export default async function ComptaPage() {
  const t = await chargerTout(await depot());
  const s = synthese(t.encaissements, t.declarations, t.parametres, t.jour);
  const impayees = t.factures.filter((f) => f.type === "facture" && ["emise", "payee_partiellement", "en_retard"].includes(f.statut));
  const enRetard = impayees.filter((f) => f.statut === "en_retard");
  const mois = new Date(`${t.jour}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader title="Compta" description="Micro-entreprise en BNC, franchise de TVA. Chiffres sur les encaissements, comme la déclaration URSSAF." />
      <SousNav actif="/compta" />
      {!t.parametres?.date_debut_activite && (
        <p className="mb-5 rounded-lg border border-warn/30 bg-warn/15 px-4 py-3 text-sm text-warn-ink">
          Renseignez vos coordonnées et la date de début d&apos;activité dans <Link className="underline" href="/compta/parametres">Paramètres</Link> : elles figurent sur les factures et fixent le calendrier URSSAF.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={`Encaissé · ${mois}`} value={euros(s.caMois)} />
        <StatCard label="Encaissé · trimestre" value={euros(s.caTrimestre)} />
        <StatCard label={`Encaissé · ${t.jour.slice(0, 4)}`} value={euros(s.caAnnee)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Prochaine échéance URSSAF</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {s.prochaine ? (
              <>
                <p>
                  Période du <span className="font-data">{dateFr(s.prochaine.debut)}</span> au <span className="font-data">{dateFr(s.prochaine.fin)}</span>
                  {s.prochaine.premiere ? " (première déclaration)" : ""}
                </p>
                <p className={s.prochaine.enRetard ? "font-medium text-lost-ink" : "text-text"}>
                  À déclarer au plus tard le <span className="font-data">{dateFr(s.prochaine.limite)}</span>
                  {s.prochaine.enRetard ? " — date dépassée" : ""}
                </p>
                <p>
                  CA encaissé à déclarer : <Montant c={s.prochaine.estimation.chiffreAffaires} /> · cotisations estimées : <Montant c={s.prochaine.estimation.total} />
                  {s.prochaine.estimation.acre ? " (ACRE)" : ""}
                </p>
                <p className="text-[12.5px] text-muted">{MENTION_ESTIMATION}.</p>
                <Link href="/compta/urssaf" className="inline-block text-[13px] font-medium text-primary-ink underline">Écran « À déclarer »</Link>
              </>
            ) : (
              <p className="text-muted">Date de début d&apos;activité à renseigner.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Seuils de l&apos;année</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Jauge titre="Plafond du régime micro (BNC)" valeurs={s.jauges.micro} aide={s.plafond !== 8_360_000 ? "proratisé l'année de création" : undefined} />
            <Jauge titre="Franchise de TVA" valeurs={s.jauges.tva} aide={`seuil majoré ${euros(s.jauges.tvaMajore.seuil)}`} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>
            Factures impayées {enRetard.length > 0 && <span className="ml-2 align-middle text-sm font-medium text-lost-ink">· {enRetard.length} en retard</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {impayees.length === 0 ? (
            <p className="text-sm text-muted">Aucune facture en attente de paiement.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {impayees.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <Link href={`/compta/factures/${f.id}`} className="min-w-0">
                    <span className="font-data text-sm text-text">{f.numero}</span> <span className="text-sm text-muted">· {f.client_nom}</span>
                    {f.echeance && <span className="block text-[12.5px] text-faint">échéance {dateFr(f.echeance)}</span>}
                  </Link>
                  <span className="flex items-center gap-3">
                    <Montant c={f.reste} className="text-sm" />
                    <StatutFacture statut={f.statut} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
