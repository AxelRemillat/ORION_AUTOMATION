import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { Jauge, SousNav } from "@/components/compta/elements";
import { euros } from "@/lib/compta/calculs";
import { COMPTA_CONFIG, SOURCES } from "@/lib/compta/config";
import { chargerTout, depot } from "@/lib/compta/contexte";
import { synthese } from "@/lib/compta/tableau";

export const metadata = { title: "Seuils · Compta" };

export default async function SeuilsPage() {
  const t = await chargerTout(await depot());
  const s = synthese(t.encaissements, t.declarations, t.parametres, t.jour);
  const annee = t.jour.slice(0, 4);
  return (
    <>
      <PageHeader title="Seuils" description={`Chiffre d'affaires encaissé en ${annee} face aux seuils du régime. Alerte à ${Math.round(COMPTA_CONFIG.alerte * 100)} %.`} />
      <SousNav actif="/compta/seuils" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Plafond du régime micro-entreprise (BNC)</CardTitle>
            <CardDescription>
              {euros(COMPTA_CONFIG.plafondMicro)} par an
              {s.plafond !== COMPTA_CONFIG.plafondMicro ? `, proratisé à ${euros(s.plafond)} pour l'année de création` : ""}. Le régime micro n&apos;est perdu qu&apos;après deux années consécutives de dépassement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Jauge titre={`CA ${annee}`} valeurs={s.jauges.micro} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Franchise en base de TVA (prestations de services)</CardTitle>
            <CardDescription>
              Seuil {euros(COMPTA_CONFIG.seuilTva)} ; au-delà du seuil majoré de {euros(COMPTA_CONFIG.seuilTvaMajore)}, la TVA est due dès le jour du dépassement : il faudra alors facturer la TVA et prévenir le service des impôts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Jauge titre="Seuil de franchise" valeurs={s.jauges.tva} />
            <Jauge titre="Seuil majoré" valeurs={s.jauges.tvaMajore} />
          </CardContent>
        </Card>
      </div>
      <p className="mt-6 text-[12px] leading-relaxed text-faint">
        Valeurs en vigueur en 2026, revérifiées le 18/11/2026 : <a className="underline" href={SOURCES.plafondMicro.url}>plafond micro</a> (vérifié le {SOURCES.plafondMicro.verifiee}) ·{" "}
        <a className="underline" href={SOURCES.franchiseTva.url}>franchise de TVA</a> (vérifié le {SOURCES.franchiseTva.verifiee}). Ces seuils changent : à revérifier chaque année (lib/compta/config.ts).
      </p>
    </>
  );
}
