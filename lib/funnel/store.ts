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

/**
 * REPRISE des signaux « non examinés » (plafond du run précédent atteint).
 *
 * La moisson ne réécrit pas un signal déjà vu : un signal laissé « non examiné »
 * au run précédent restait donc clos à jamais. Le 05/10, le second run n'a rien
 * trouvé de neuf (mêmes signaux une heure plus tard) et les 465 signaux non
 * examinés de la veille n'ont jamais été repris — relever le plafond ne servait
 * à rien. Ils rejoignent maintenant le run courant (même ligne, statut « brut ») ;
 * rien n'est supprimé, et un signal rejeté pour un autre motif ne bouge pas.
 */
export async function reopenUnexamined(db: Db, userId: string, runId: string, hashes: readonly string[]): Promise<number> {
  let reopened = 0;
  for (let index = 0; index < hashes.length; index += 200) {
    const { data, error } = await db
      .from("signal_candidates")
      .update({ run_id: runId, statut: "brut", motif_rejet: null })
      .eq("user_id", userId)
      .eq("statut", "rejeté")
      .like("motif_rejet", `${NOT_EXAMINED}%`)
      .in("hash", hashes.slice(index, index + 200))
      .select("id");
    if (error) throw new Error(`reprise des signaux non examinés impossible : ${error.message}`);
    reopened += data?.length ?? 0;
  }
  return reopened;
}

/** Taille d'une page de lecture : l'API renvoie au plus 1 000 lignes par requête. */
const PAGE = 1000;

/**
 * Candidats d'un run, TOUS : lus par pages de 1 000.
 *
 * Constaté le 30/09/2026 : le run comptait 2 653 signaux, la lecture n'en
 * rendait que 1 000 (limite de l'API), et le bandeau affichait « 1000 signaux ».
 * Les étages ne voyaient donc que 38 % du run.
 */
export async function candidatesOf(db: Db, userId: string, runId: string, statut?: CandidateStatus) {
  const rows: SignalCandidateRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db.from("signal_candidates").select("*").eq("user_id", userId).eq("run_id", runId);
    if (statut) query = query.eq("statut", statut);
    const { data, error } = await query
      .order("date_signal", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`candidats illisibles : ${error.message}`);
    rows.push(...((data ?? []) as SignalCandidateRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * Retenus pas encore creusés, TOUS RUNS CONFONDUS : le creusage d'un run
 * reprend d'abord ceux qu'un run précédent n'a pas eu le temps de traiter.
 */
export async function pendingDigOf(db: Db, userId: string) {
  const { data, error } = await db
    .from("signal_candidates")
    .select("*")
    .eq("user_id", userId)
    .eq("statut", "retenu")
    // Sans motif, ou en erreur passagère lors d'un creusage précédent.
    .or("motif_rejet.is.null,motif_rejet.like.creusage à reprendre%")
    .order("score", { ascending: false })
    .limit(200);
  if (error) throw new Error(`retenus en attente illisibles : ${error.message}`);
  return (data ?? []) as SignalCandidateRow[];
}

/** Même mise à jour sur plusieurs lignes, par paquets (une requête par paquet). */
export async function updateCandidates(db: Db, ids: readonly string[], patch: Database["public"]["Tables"]["signal_candidates"]["Update"]) {
  for (let index = 0; index < ids.length; index += 200) {
    const { error } = await db.from("signal_candidates").update(patch).in("id", ids.slice(index, index + 200));
    if (error) throw new Error(`candidats non mis à jour : ${error.message}`);
  }
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

/** Motif des signaux laissés de côté par le plafond d'examen (cf. stages.ts). */
export const NOT_EXAMINED = "non examiné";

/** Rendement d'une source : de la moisson au contact. */
export interface SourceYield {
  source: string;
  bruts: number;
  examines: number;
  filtres: number;
  retenus: number;
  creuses: number;
  contactables: number;
}

/** Rendement par source, pour le bandeau et le journal du run. */
export function yieldBySource(
  rows: readonly Pick<SignalCandidateRow, "source" | "statut" | "publication" | "motif_rejet" | "triage">[],
): SourceYield[] {
  const by = new Map<string, SourceYield>();
  for (const row of rows) {
    const entry = by.get(row.source) ?? { source: row.source, bruts: 0, examines: 0, filtres: 0, retenus: 0, creuses: 0, contactables: 0 };
    entry.bruts += 1;
    const examined = row.statut !== "brut" && !(row.motif_rejet ?? "").startsWith(NOT_EXAMINED);
    if (examined) entry.examines += 1;
    // A passé le filtre : il attend le tri, ou le tri l'a vu (retenu ou non).
    if (row.statut === "filtré" || row.triage != null) entry.filtres += 1;
    if (["retenu", "creusé"].includes(row.statut) || (row.motif_rejet ?? "").startsWith("creusage")) entry.retenus += 1;
    if (row.statut === "creusé") entry.creuses += 1;
    if (row.publication === "pret") entry.contactables += 1;
    by.set(row.source, entry);
  }
  return [...by.values()].sort((a, b) => b.bruts - a.bruts);
}

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
