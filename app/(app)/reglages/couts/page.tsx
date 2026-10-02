import { requireUser } from "@/lib/auth";
import { hunterDailyBudget } from "@/lib/hunter/gate";
import { budgets, monthlyCosts } from "@/lib/settings/costs";
import { createClient } from "@/lib/supabase/server";
import { BudgetsCard } from "./budgets-card";
import { CostsView } from "./costs-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coûts · Réglages · ORION" };

/** Réglages › Coûts : budgets, dépense par mois, puis le détail de l'ancienne page /couts. */
export default async function CoutsPage() {
  await requireUser();
  const supabase = createClient();
  const since = new Date(Date.now() - 200 * 86_400_000).toISOString();
  const { data } = await supabase.from("api_usage").select("service, cost, created_at").gte("created_at", since).limit(50_000);
  return (
    <>
      <BudgetsCard budgets={budgets(process.env, hunterDailyBudget())} months={monthlyCosts(data ?? [])} />
      <CostsView />
    </>
  );
}
