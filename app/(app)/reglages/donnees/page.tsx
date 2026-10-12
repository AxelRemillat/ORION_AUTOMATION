import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadVolumes } from "@/lib/settings/volumes-server";
import { StatsView } from "./stats-view";
import { VolumesCard } from "./volumes-card";
import { VariantsCard } from "./variants-card";
import { loadVariantStats } from "@/lib/variants/load";
import { platformStats } from "@/lib/opportunities/stats";
import type { Opportunity } from "@/lib/opportunities/types";
import { OpportunitiesCard } from "./opportunities-card";
import { readAll } from "@/lib/supabase/read-all";

export const dynamic = "force-dynamic";
export const metadata = { title: "Données · Réglages · ORION" };

/** Réglages › Données : volumes et export, puis les statistiques de l'ancienne page /stats. */
export default async function DonneesPage() {
  const user = await requireUser();
  const db = createClient();
  const [volumes, variants, opportunities] = await Promise.all([
    loadVolumes(db, user.id),
    loadVariantStats(db),
    // Table absente (avant migration) : aucune ligne, la carte reste vide.
    // Toutes les fiches (Cowork #24) : les totaux par plateforme s'arrêtaient à 1 000.
    readAll<Opportunity>(() => (db as unknown as { from: (table: string) => any }).from("opportunities").select("platform, status, sent_at, replied_at, amount_eur").order("id")).catch(() => [] as Opportunity[]),
  ]);
  return (
    <>
      <VolumesCard volumes={volumes} />
      <VariantsCard sends={variants.sends} stats={variants.stats} />
      <OpportunitiesCard rows={platformStats(opportunities)} />
      <StatsView />
    </>
  );
}
