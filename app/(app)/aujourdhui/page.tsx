import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { readPrefs } from "@/lib/funnel/settings";
import { lastPrepareHealth, livePrepareJob, prepareAlert } from "@/lib/today/auto-run";
import { loadCapacity } from "@/lib/today/capacity";
import { flatten } from "@/lib/today/group";
import { cachedOpenAiBudget } from "@/lib/today/openai-gate";
import { loadToday } from "@/lib/today/load";
import { loadYieldPlan } from "@/lib/today/yield";
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
    // Plafond OpenAI : valeur de moins de 5 min (sa lecture complète prenait ≈ 2 s, Cowork #25).
    cachedOpenAiBudget().catch(() => null),
  ]);
  const items = flatten(data.groups);
  // « Céder la place aux relances » : calculé seulement quand le plafond est engagé (lecture seule).
  const yieldPlan = await loadYieldPlan(db, user.id, capacity, items).catch(() => null);
  return (
    <TodayClient
      today={data.today}
      items={items}
      yieldPlan={yieldPlan}
      capacity={capacity}
      liveJobId={liveJobId}
      alert={liveJobId ? null : prepareAlert(health)}
      blockedReason={openai?.level === "plafond" ? openai.message : null}
      dailyTarget={prefs.dailyTarget}
      initialKey={typeof searchParams.item === "string" ? searchParams.item : null}
    />
  );
}
