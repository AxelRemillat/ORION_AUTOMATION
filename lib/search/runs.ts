import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanPhase, ScanProgress } from "@/lib/enrichment";
import type { Database, SearchRun, SearchRunStatus } from "@/types";

/**
 * Cycle de vie d'un scan observable.
 *
 * Un scan n'est plus une requête qui bloque un écran : c'est une ligne de
 * `search_runs` qu'on écrit au fil de l'eau et que le client relit. Ce module
 * est la seule porte d'entrée vers cette table — les routes ne composent pas
 * de requête à la main.
 */

/** Au-delà, un scan qui n'a plus donné signe de vie est réputé interrompu. */
export const STALE_AFTER_MS = 90_000;

type Client = SupabaseClient<Database>;

/**
 * L'avancement stocké est exactement celui que le scan émet : un alias, pas une
 * copie, pour qu'un champ ajouté au scan ne puisse pas être oublié ici.
 *
 * `progress` est une colonne jsonb, donc ce type doit rester assignable à
 * `Record<string, unknown>` — c'est la signature d'index de `ScanProgress` qui
 * le garantit. Sans elle, TypeScript refuse l'écriture alors que la forme est
 * bonne.
 */
export type RunProgress = ScanProgress;

export const EMPTY_PROGRESS: RunProgress = {
  phase: "annuaire",
  pagesRead: 0,
  pagesPlanned: 0,
  scanned: 0,
  withSignal: 0,
  analysed: 0,
  analysedPlanned: 0,
  step: "Préparation du scan",
};

/** Ouvre un scan. La ligne existe AVANT le premier appel payant. */
export async function startRun(
  supabase: Client,
  criteria: Record<string, unknown>,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("search_runs")
    .insert({ criteria, status: "running", progress: EMPTY_PROGRESS })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}

/** Écrit l'avancement. Une écriture ratée ne doit jamais casser le scan. */
export async function saveProgress(
  supabase: Client,
  id: string,
  progress: RunProgress,
): Promise<void> {
  await supabase.from("search_runs").update({ progress }).eq("id", id);
}

/** Clôt le scan, quelle qu'en soit l'issue. */
export async function finishRun(
  supabase: Client,
  id: string,
  outcome: {
    status: SearchRunStatus;
    results?: unknown[];
    warnings?: unknown[];
    progress?: RunProgress;
    error?: string | null;
  },
): Promise<void> {
  await supabase
    .from("search_runs")
    .update({
      status: outcome.status,
      results: outcome.results ?? [],
      warnings: outcome.warnings ?? [],
      ...(outcome.progress ? { progress: outcome.progress } : {}),
      error: outcome.error ?? null,
    })
    .eq("id", id);
}

/** L'utilisateur a cliqué « Arrêter ». Le scan le relit entre deux lots. */
export async function requestStop(supabase: Client, id: string): Promise<void> {
  await supabase.from("search_runs").update({ stop_requested: true }).eq("id", id);
}

export async function isStopRequested(supabase: Client, id: string): Promise<boolean> {
  const { data } = await supabase
    .from("search_runs")
    .select("stop_requested")
    .eq("id", id)
    .maybeSingle();
  return Boolean(data?.stop_requested);
}

/**
 * Le dernier scan de l'utilisateur, en cours ou terminé.
 *
 * C'est lui qui fait tenir la persistance : au retour sur l'écran, on
 * réaffiche soit la barre là où elle en est, soit les résultats du dernier
 * scan — sans avoir rien relancé.
 */
export async function latestRun(supabase: Client): Promise<SearchRun | null> {
  const { data } = await supabase
    .from("search_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SearchRun) ?? null;
}

/**
 * Avancement tel qu'il est stocké, avec des valeurs sûres à l'affichage.
 *
 * Volontairement à côté de l'écriture : `progress` est un jsonb, donc rien ne
 * garantit sa forme au retour — une valeur d'une ancienne version du code, ou
 * une ligne écrite à moitié, ne doit pas faire afficher « undefined ».
 */
export function readProgress(run: Pick<SearchRun, "progress"> | null): RunProgress {
  const raw = (run?.progress ?? {}) as Record<string, unknown>;
  const num = (key: string) => (typeof raw[key] === "number" ? (raw[key] as number) : 0);
  const phase: ScanPhase = raw.phase === "fiches" ? "fiches" : "annuaire";
  return {
    phase,
    pagesRead: num("pagesRead"),
    pagesPlanned: num("pagesPlanned"),
    scanned: num("scanned"),
    withSignal: num("withSignal"),
    analysed: num("analysed"),
    analysedPlanned: num("analysedPlanned"),
    step: typeof raw.step === "string" ? raw.step : EMPTY_PROGRESS.step,
  };
}

/**
 * Part de la barre réservée à la phase 1.
 *
 * Elle reflète le temps réel : lire l'annuaire et scanner, c'est l'essentiel de
 * l'attente ; ouvrir les fiches est court.
 */
export const SCAN_SHARE = 0.8;

/**
 * Remplissage de la barre, entre 0 et 1.
 *
 * Deux grandeurs seulement, parce que ce sont les deux seules dont on connaisse
 * la borne à l'avance : les pages pendant la phase 1, les fiches pendant la
 * phase 2. Les compteurs bruts (vérifiées, signaux) montent sans plafond connu
 * — les mettre en barre aurait donné une progression qui recule quand le plan
 * s'allonge.
 */
export function progressRatio(progress: RunProgress): number {
  if (progress.phase === "fiches") {
    const done = progress.analysedPlanned
      ? Math.min(1, progress.analysed / progress.analysedPlanned)
      : 1;
    return SCAN_SHARE + (1 - SCAN_SHARE) * done;
  }
  // Plan encore inconnu : une barre a peine entamee plutot qu'une barre vide,
  // le scan a bien commence.
  if (!progress.pagesPlanned) return 0.05;
  return SCAN_SHARE * Math.min(1, progress.pagesRead / progress.pagesPlanned);
}

/**
 * Un scan « running » dont la fonction serverless a été coupée reste running
 * pour toujours. On le considère interrompu passé un silence, plutôt que
 * d'afficher une barre qui n'avancera jamais.
 */
export function isStale(run: Pick<SearchRun, "status" | "updated_at">, now = Date.now()): boolean {
  if (run.status !== "running") return false;
  return now - Date.parse(run.updated_at) > STALE_AFTER_MS;
}

/** État affiché : un scan périmé est présenté comme interrompu. */
export function effectiveStatus(
  run: Pick<SearchRun, "status" | "updated_at">,
  now = Date.now(),
): SearchRunStatus {
  return isStale(run, now) ? "stopped" : run.status;
}
