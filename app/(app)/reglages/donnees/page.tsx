import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadVolumes } from "@/lib/settings/volumes-server";
import { StatsView } from "./stats-view";
import { VolumesCard } from "./volumes-card";
import { VariantsCard } from "./variants-card";
import { loadVariantStats } from "@/lib/variants/load";

export const dynamic = "force-dynamic";
export const metadata = { title: "Données · Réglages · ORION" };

/** Réglages › Données : volumes et export, puis les statistiques de l'ancienne page /stats. */
export default async function DonneesPage() {
  const user = await requireUser();
  const db = createClient();
  const [volumes, variants] = await Promise.all([loadVolumes(db, user.id), loadVariantStats(db)]);
  return (
    <>
      <VolumesCard volumes={volumes} />
      <VariantsCard sends={variants.sends} stats={variants.stats} />
      <StatsView />
    </>
  );
}
