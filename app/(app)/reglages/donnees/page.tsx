import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadVolumes } from "@/lib/settings/volumes-server";
import { StatsView } from "./stats-view";
import { VolumesCard } from "./volumes-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Données · Réglages · ORION" };

/** Réglages › Données : volumes et export, puis les statistiques de l'ancienne page /stats. */
export default async function DonneesPage() {
  const user = await requireUser();
  const volumes = await loadVolumes(createClient(), user.id);
  return (
    <>
      <VolumesCard volumes={volumes} />
      <StatsView />
    </>
  );
}
