import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyBase } from "@/lib/enrichment/types";
import type { Database, SignalCandidateRow } from "@/types";
import type { CandidateStatus, FunnelCounts, HarvestedSignal, SignalFacts } from "./types";

/**
 * Seule porte d'accès à `signal_candidates`. Le job tourne avec le client
 * service_role : chaque requête filtre explicitement sur `user_id`.
 */

type Db = SupabaseClient<Database>;

/** Écrit la moisson. Un signal déjà vu (même empreinte) n'est pas réécrit. */
export async function insertHarvest(db: Db, userId: string, runId: string, signals: readonly HarvestedSignal[]) {
  let inserted = 0;
  for (let index = 0; index < signals.length; index += 200) {
    const rows = signals.slice(index, index + 200).map((signal) => ({
      user_id: userId,
      run_id: runId,
      source: signal.source,
      date_signal: signal.date,
      texte_brut: signal.text,
      url_source: signal.url,
      siren: signal.siren,
      company_name: signal.companyName,
      hash: signal.hash,
      statut: "brut" as const,
      facts: signal.facts as unknown as Record<string, unknown>,
    }));
    const { data, error } = await db
      .from("signal_candidates")
      .upsert(rows, { onConflict: "user_id,hash", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`moisson non enregistrée : ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return inserted;
}

export async function candidatesOf(db: Db, userId: string, runId: string, statut?: CandidateStatus) {
  let query = db.from("signal_candidates").select("*").eq("user_id", userId).eq("run_id", runId);
  if (statut) query = query.eq("statut", statut);
  const { data, error } = await query.order("date_signal", { ascending: false });
  if (error) throw new Error(`candidats illisibles : ${error.message}`);
  return (data ?? []) as SignalCandidateRow[];
}

export async function updateCandidate(db: Db, id: string, patch: Database["public"]["Tables"]["signal_candidates"]["Update"]) {
  const { error } = await db.from("signal_candidates").update(patch).eq("id", id);
  if (error) throw new Error(`candidat non mis à jour : ${error.message}`);
}

/** Une ligne relue → le signal de l'étage 1. */
export function rowToSignal(row: SignalCandidateRow): HarvestedSignal {
  return {
    source: row.source as HarvestedSignal["source"],
    date: row.date_signal ?? row.created_at.slice(0, 10),
    text: row.texte_brut,
    url: row.url_source,
    siren: row.siren,
    companyName: row.company_name ?? "",
    facts: row.facts as unknown as SignalFacts,
    hash: row.hash,
  };
}

/** Fiche annuaire conservée au filtre, pour le creusage (étape suivante). */
export const baseOf = (row: SignalCandidateRow): CompanyBase | null =>
  ((row.identity as { base?: CompanyBase } | null)?.base ?? null);

/** Compteurs du bandeau : bruts → filtrés → retenus → creusés → contactables. */
export function countFunnel(rows: readonly Pick<SignalCandidateRow, "statut" | "publication">[]): FunnelCounts {
  const passed = (statuts: CandidateStatus[]) => rows.filter((row) => statuts.includes(row.statut)).length;
  return {
    bruts: rows.length,
    filtres: passed(["filtré", "retenu", "creusé"]),
    retenus: passed(["retenu", "creusé"]),
    creuses: passed(["creusé"]),
    contactables: rows.filter((row) => row.publication === "pret").length,
  };
}
