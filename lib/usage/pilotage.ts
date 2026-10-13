import type { SupabaseClient } from "@supabase/supabase-js";
import { parisToUtc, utcToParis } from "@/lib/outbox/paris-time";
import { hunterDailyBudget, parisMidnight } from "@/lib/hunter/gate";
import { readAll } from "@/lib/supabase/read-all";
import { buildReadiness, READY_SCORE, type Readiness } from "./readiness";
import { openAiBudgetState, openAiMonthlyCap, type OpenAiBudgetState } from "./budgets";
import {
  buildConsumption,
  buildConsumptionFromDaily,
  consumptionSince,
  sumDailyUnits,
  toDailyRows,
  type Consumption,
  type DailyRow,
  type FreeRow,
  type UsageRow,
} from "./consumption";
import { readDailyFree, readDailyUsage } from "./usage-daily";
import {
  buildCreditTiles,
  cachedExact,
  fetchHunterExact,
  fetchPappersExact,
  hunterCycleStart,
  openAiMonthlyBudget,
  withinMs,
  type CreditTile,
} from "./credits";

/**
 * Données du bloc « Pilotage » du Cockpit, agrégées CÔTÉ BASE : les journées de
 * consommation (vues `*_daily`), les mails prêts, et deux soldes fournisseurs
 * en cache 1 h, bornés en temps. Le client ne reçoit que des agrégats.
 *
 * 12/10/2026 — ce bloc coûtait 4,4 s des 5,0 s du Cockpit (mesure
 * `scripts/pilotage-chrono.ts`). Deux causes, toutes deux corrigées ici :
 *   - les mails prêts étaient lus APRÈS les autres lectures, sans en dépendre ;
 *   - la consommation était relue ligne à ligne, 12 076 lignes sur 30 jours,
 *     soit 14 aller-retours de 1 000 lignes pour refaire un `group by`.
 */

type Loose = SupabaseClient<any, "public", any>;

export interface Pilotage {
  consumption: Consumption;
  credits: CreditTile[];
  /** Plafond mensuel OpenAI : alerte à 80 %, arrêt de la préparation à 100 %. */
  openai: OpenAiBudgetState;
  /** Mails prêts (brouillons notés ≥ 9) par jour et coût par mail prêt, 30 jours. */
  readiness: Readiness;
}

/** Soldes fournisseurs : jamais plus de 700 ms d'attente, sinon estimation. */
const PROVIDER_WAIT_MS = 700;

/**
 * Consommation des 30 jours : par les vues agrégées, sinon ligne à ligne.
 * Rend aussi les journées, dont les compteurs de crédits ont besoin.
 */
async function readConsumption(loose: Loose, since: string, now: Date): Promise<{ consumption: Consumption; daily: DailyRow[] }> {
  const fromDay = since.slice(0, 10);
  const [daily, dailyFree] = await Promise.all([readDailyUsage(loose, fromDay), readDailyFree(loose, fromDay)]);
  if (daily && dailyFree) {
    return { consumption: buildConsumptionFromDaily([...daily, ...dailyFree], now), daily };
  }

  // Repli : les vues n'existent pas encore (migration pas appliquée). Lecture
  // COMPLÈTE page par page — au-delà de 1 000 lignes, PostgREST tronque en silence.
  const [usage, free] = await Promise.all([
    readAll<UsageRow>(() =>
      loose.from("api_usage").select("service, units, cost, created_at").gte("created_at", since).order("created_at").order("id"),
    ),
    // Table ajoutée par la migration 20261002221834 : absente, elle ne casse rien.
    readAll<FreeRow>(() =>
      loose.from("free_api_calls").select("service, units, created_at").gte("created_at", since).order("created_at").order("id"),
    ).catch(() => [] as FreeRow[]),
  ]);
  // Mêmes journées que celles de la vue : le reste du calcul ne voit pas la différence.
  const rows = toDailyRows(usage, free);
  return { consumption: buildConsumptionFromDaily(rows, now), daily: rows };
}

export async function loadPilotage(db: unknown, now = new Date()): Promise<Pilotage> {
  const loose = db as Loose;
  const since = consumptionSince(now);
  // Les quatre lectures sont indépendantes : elles partent ensemble. Les mails
  // prêts attendaient les autres pour rien (Cowork #22).
  const [{ consumption, daily }, drafts, hunterExact, pappersExact] = await Promise.all([
    readConsumption(loose, since, now),
    // Brouillons d'intro notés ≥ 9 (colonne quality_score) ; absente : aucun mail prêt compté.
    readAll<{ created_at: string; quality_score: number | null; origin?: string | null; type?: string | null }>(() =>
      loose
        .from("messages")
        .select("id, created_at, quality_score, origin, type")
        .eq("type", "intro")
        .gte("quality_score", READY_SCORE)
        .is("deleted_at", null)
        .gte("created_at", since)
        .order("id"),
    ).catch(() => [] as { created_at: string; quality_score: number | null }[]),
    withinMs(cachedExact("hunter", fetchHunterExact), PROVIDER_WAIT_MS, null),
    withinMs(cachedExact("pappers", fetchPappersExact), PROVIDER_WAIT_MS, null),
  ]);

  // Bornes à minuit, heure de Paris (changement d'heure compris).
  const cycle = parisToUtc(hunterCycleStart(now), "00:00") as Date;
  const monthStart = parisToUtc(`${consumption.days.at(-1)!.day.slice(0, 7)}-01`, "00:00") as Date;
  /*
   * Unités consommées depuis une borne. Les bornes sont des minuits de Paris,
   * donc des frontières de journée : sommer des journées ne perd rien. Le repli
   * produit les mêmes journées, le calcul est donc identique dans les deux cas.
   */
  const sum = (service: string, from: Date) => sumDailyUnits(daily, service, utcToParis(from).date);

  return {
    consumption,
    readiness: buildReadiness(consumption.days, drafts),
    openai: openAiBudgetState(consumption.month.byProvider.openai, openAiMonthlyCap()),
    credits: buildCreditTiles({
      hunterUsed: Math.round(sum("hunter", cycle)),
      pappersUsed: Math.round(sum("pappers", monthStart)),
      openaiEur: consumption.month.byProvider.openai,
      hunterExact,
      pappersExact,
      openaiBudget: openAiMonthlyBudget(),
      now,
      hunterToday: { used: Math.round(sum("hunter", parisMidnight(now))), budget: hunterDailyBudget() },
    }),
  };
}
