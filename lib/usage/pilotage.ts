import type { SupabaseClient } from "@supabase/supabase-js";
import { parisToUtc } from "@/lib/outbox/paris-time";
import { readAll } from "@/lib/supabase/read-all";
import { buildConsumption, consumptionSince, type Consumption, type FreeRow, type UsageRow } from "./consumption";
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
 * Données du bloc « Pilotage » du Cockpit, agrégées CÔTÉ SERVEUR : deux
 * lectures en base (30 jours) et deux soldes fournisseurs en cache 1 h, bornés
 * en temps. Le client ne reçoit que des agrégats.
 */

type Loose = SupabaseClient<any, "public", any>;

export interface Pilotage {
  consumption: Consumption;
  credits: CreditTile[];
}

/** Soldes fournisseurs : jamais plus de 700 ms d'attente, sinon estimation. */
const PROVIDER_WAIT_MS = 700;

export async function loadPilotage(db: unknown, now = new Date()): Promise<Pilotage> {
  const loose = db as Loose;
  const since = consumptionSince(now);
  // Lecture COMPLÈTE (pages de 1 000) : au-delà, PostgREST tronque en silence.
  const [usage, free, hunterExact, pappersExact] = await Promise.all([
    readAll<UsageRow>(() =>
      loose.from("api_usage").select("service, units, cost, created_at").gte("created_at", since).order("created_at").order("id"),
    ),
    // Table ajoutée par la migration 20261002221834 : absente, elle ne casse rien.
    readAll<FreeRow>(() =>
      loose.from("free_api_calls").select("service, units, created_at").gte("created_at", since).order("created_at").order("id"),
    ).catch(() => [] as FreeRow[]),
    withinMs(cachedExact("hunter", fetchHunterExact), PROVIDER_WAIT_MS, null),
    withinMs(cachedExact("pappers", fetchPappersExact), PROVIDER_WAIT_MS, null),
  ]);
  const consumption = buildConsumption(usage, free, now);

  // Bornes à minuit, heure de Paris (changement d'heure compris).
  const cycle = parisToUtc(hunterCycleStart(now), "00:00") as Date;
  const monthStart = parisToUtc(`${consumption.days.at(-1)!.day.slice(0, 7)}-01`, "00:00") as Date;
  const sum = (rows: UsageRow[], service: string, from: Date) =>
    rows
      .filter((row) => row.service === service && Date.parse(row.created_at) >= from.getTime())
      .reduce((total, row) => total + (Number(row.units) || 0), 0);

  return {
    consumption,
    credits: buildCreditTiles({
      hunterUsed: Math.round(sum(usage, "hunter", cycle)),
      pappersUsed: Math.round(sum(usage, "pappers", monthStart)),
      openaiEur: consumption.month.byProvider.openai,
      hunterExact,
      pappersExact,
      openaiBudget: openAiMonthlyBudget(),
      now,
    }),
  };
}
