import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_COLUMNS, type Job } from "@/lib/jobs/types";
import type { Database } from "@/types";
import { runCost } from "./cost";
import { hunterStatus, type HunterStatus } from "@/lib/hunter/gate";
import { pappersCredits } from "@/lib/usage/balances";
import { candidatesOf, countFunnel, yieldBySource, type SourceYield } from "./store";
import type { FunnelCost, FunnelCounts } from "./types";
import { registryUsage, type RegistryUsage } from "./registry";
import { cardsOf, rejectsOf, type FunnelCard, type FunnelReject } from "./view";

/**
 * État du dernier run de l'entonnoir, tel que l'écran le sonde : le job (qui
 * porte l'avancement), les compteurs du bandeau, le coût, les cartes.
 */

type Db = SupabaseClient<Database>;
type Loose = SupabaseClient<any, "public", any>;

export interface FunnelSnapshot {
  job: Pick<Job, "id" | "status" | "progress" | "error" | "created_at" | "finished_at"> | null;
  runId: string | null;
  counts: FunnelCounts;
  /** Rendement par source : bruts → examinés → filtrés → retenus → contactables. */
  bySource: SourceYield[];
  cost: FunnelCost | null;
  /** Part des cartes affichées qui ont un signal daté ET un email (objectif ≥ 60 %). */
  readyShare: number | null;
  cards: FunnelCard[];
  rejects: FunnelReject[];
  /** Hunter aujourd'hui : recherches facturées, budget du jour, blocage éventuel. */
  hunter: HunterStatus | null;
  /** Registre du creusage : fiches lues par Pappers ou en gratuit, crédits Pappers restants. */
  registry: RegistryUsage | null;
}

/** Recherches Hunter facturées aujourd'hui, lues avec la session de l'écran. */
async function hunterToday(db: Db): Promise<HunterStatus | null> {
  return hunterStatus({
    read: async () => null,
    write: async () => undefined,
    async usedSince(since) {
      const { data, error } = await db.from("api_usage").select("units").eq("service", "hunter").gte("created_at", since.toISOString());
      if (error) throw new Error(error.message);
      return (data ?? []).reduce((total, row) => total + (Number(row.units) || 0), 0);
    },
  }).catch(() => null);
}

const EMPTY: FunnelCounts = { bruts: 0, filtres: 0, retenus: 0, creuses: 0, contactables: 0 };

export async function latestFunnel(db: Db, userId: string): Promise<FunnelSnapshot> {
  const { data } = await (db as unknown as Loose)
    .from("jobs")
    .select(PUBLIC_COLUMNS)
    .eq("type", "search_signals")
    // La préparation du matin est un run d'entonnoir comme un autre.
    .in("params->>kind", ["funnel", "prepare"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const job = (data as Job | null) ?? null;
  const runId = typeof job?.result?.runId === "string" ? job.result.runId : null;
  if (!job || !runId) {
    return { job, runId, counts: EMPTY, bySource: [], cost: null, readyShare: null, cards: [], rejects: [], hunter: null, registry: null };
  }

  const rows = await candidatesOf(db, userId, runId);
  const cards = cardsOf(rows);
  const dug = cards.filter((card) => card.statut === "creusé");
  const ready = dug.filter((card) => card.date && card.email).length;
  return {
    job,
    runId,
    counts: countFunnel(rows),
    bySource: yieldBySource(rows),
    cost: await runCost(db, userId, job.started_at ?? job.created_at).catch(() => null),
    readyShare: dug.length ? ready / dug.length : null,
    cards,
    rejects: rejectsOf(rows),
    hunter: await hunterToday(db),
    registry: registryUsage(cards, await pappersCredits().catch(() => null)),
  };
}
