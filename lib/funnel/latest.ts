import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_COLUMNS, type Job } from "@/lib/jobs/types";
import type { Database } from "@/types";
import { runCost } from "./cost";
import { candidatesOf, countFunnel } from "./store";
import type { FunnelCost, FunnelCounts } from "./types";
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
  cost: FunnelCost | null;
  /** Part des cartes affichées qui ont un signal daté ET un email (objectif ≥ 60 %). */
  readyShare: number | null;
  cards: FunnelCard[];
  rejects: FunnelReject[];
}

const EMPTY: FunnelCounts = { bruts: 0, filtres: 0, retenus: 0, creuses: 0, contactables: 0 };

export async function latestFunnel(db: Db, userId: string): Promise<FunnelSnapshot> {
  const { data } = await (db as unknown as Loose)
    .from("jobs")
    .select(PUBLIC_COLUMNS)
    .eq("type", "search_signals")
    .eq("params->>kind", "funnel")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const job = (data as Job | null) ?? null;
  const runId = typeof job?.result?.runId === "string" ? job.result.runId : null;
  if (!job || !runId) return { job, runId, counts: EMPTY, cost: null, readyShare: null, cards: [], rejects: [] };

  const rows = await candidatesOf(db, userId, runId);
  const cards = cardsOf(rows);
  const dug = cards.filter((card) => card.statut === "creusé");
  const ready = dug.filter((card) => card.date && card.email).length;
  return {
    job,
    runId,
    counts: countFunnel(rows),
    cost: await runCost(db, userId, job.started_at ?? job.created_at).catch(() => null),
    readyShare: dug.length ? ready / dug.length : null,
    cards,
    rejects: rejectsOf(rows),
  };
}
