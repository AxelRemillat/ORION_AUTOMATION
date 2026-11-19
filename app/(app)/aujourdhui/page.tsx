import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { TacheCarte } from "@/components/crm/tache-carte";
import { depotCrm } from "@/lib/crm/depot";
import { aujourdhuiParis, tachesDuJour } from "@/lib/crm/logique";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aujourd'hui" };

const ACTIVES = new Set(["a_contacter", "contacte", "maquette_envoyee", "rdv", "devis_envoye"]);

/**
 * AUJOURD'HUI (refonte CRM, Cowork #117) : les actions CRM datées d'aujourd'hui ou en retard, puis celles des
 * 7 prochains jours. L'ancien écran des mails est sous « Archives › Prospection e-mail » (lecture seule).
 */
export default async function AujourdhuiPage() {
  const commerces = await (await depotCrm()).commerces();
  const jour = aujourdhuiParis();
  const taches = tachesDuJour(commerces);
  const dans7 = aujourdhuiParis(new Date(Date.now() + 7 * 86_400_000));
  const semaine = commerces
    .filter((c) => !c.archivee_le && c.etape !== "perdu" && c.prochaine_action_le && c.prochaine_action_le > jour && c.prochaine_action_le <= dans7)
    .sort((a, b) => (a.prochaine_action_le as string).localeCompare(b.prochaine_action_le as string) || a.nom.localeCompare(b.nom, "fr"));
  const sansAction = commerces.filter((c) => !c.archivee_le && ACTIVES.has(c.etape) && !c.prochaine_action_le).length;

  return (
    <>
      <PageHeader
        title="Aujourd'hui"
        description={taches.length ? `${taches.length} action${taches.length > 1 ? "s" : ""} à faire aujourd'hui.` : "Rien d'urgent aujourd'hui."}
        actions={
          <Link
            href="/crm?nouveau=1"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-grad px-4 text-sm font-medium text-primary-fg shadow-mist"
          >
            <Plus className="size-4" aria-hidden />
            Nouvelle fiche
          </Link>
        }
      />
      <section aria-labelledby="jour-titre" className="grid gap-3">
        <h2 id="jour-titre" className="font-display text-lg text-text">
          À faire aujourd&apos;hui
        </h2>
        {taches.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {taches.map((t) => (
              <TacheCarte key={t.commerce.id} c={t.commerce} aujourdhui={jour} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Aucune relance pour aujourd'hui" description="Les prochaines actions datées des fiches du CRM apparaissent ici le jour venu." />
        )}
      </section>

      <section aria-labelledby="semaine-titre" className="mt-8 grid gap-3">
        <h2 id="semaine-titre" className="font-display text-lg text-text">
          Les 7 prochains jours
        </h2>
        {semaine.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {semaine.map((c) => (
              <TacheCarte key={c.id} c={c} aujourdhui={jour} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Rien de prévu cette semaine.</p>
        )}
        {sansAction > 0 && (
          <p className="text-sm text-muted">
            <Link href="/crm" className="text-primary-ink underline underline-offset-2">
              {sansAction} fiche{sansAction > 1 ? "s" : ""} en cours sans prochaine action
            </Link>{" "}
            : à planifier.
          </p>
        )}
      </section>
    </>
  );
}
