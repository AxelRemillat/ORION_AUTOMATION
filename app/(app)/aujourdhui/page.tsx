import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { readPrefs } from "@/lib/funnel/settings";
import { lastPrepareHealth, livePrepareJob, prepareAlert } from "@/lib/today/auto-run";
import { loadCapacity } from "@/lib/today/capacity";
import { flatten } from "@/lib/today/group";
import { openAiBudget } from "@/lib/usage/budgets-server";
import { loadToday } from "@/lib/today/load";
import { TodayClient } from "./_components/today-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aujourd'hui" };

/**
 * « Aujourd'hui » — la page d'accueil. La file est recalculée depuis les tables
 * à chaque ouverture (lib/today/load.ts) : les fiches des runs précédents y
 * figurent d'office, rien n'est recopié.
 */
export default async function AujourdhuiPage({ searchParams }: { searchParams: { item?: string } }) {
  const user = await requireUser();
  const db = createClient();
  const [data, capacity, prefs, liveJobId, health, openai] = await Promise.all([
    loadToday(db, user.id),
    loadCapacity(db, user.id),
    readPrefs(db, user.id),
    livePrepareJob(db, user.id),
    lastPrepareHealth(db, user.id).catch(() => null),
    openAiBudget({ db: db as never }).catch(() => null),
  ]);
  return (
    <TodayClient
      today={data.today}
      items={flatten(data.groups)}
      capacity={capacity}
      liveJobId={liveJobId}
      alert={liveJobId ? null : prepareAlert(health)}
      blockedReason={openai?.level === "plafond" ? openai.message : null}
      dailyTarget={prefs.dailyTarget}
      initialKey={typeof searchParams.item === "string" ? searchParams.item : null}
    />
  );
}
