/**
 * Travaux de fond (lib/jobs) — sans base ni réseau.
 *
 * Ce que ces tests verrouillent :
 *   - une étape réussie avance le job, fusionne son point de reprise et remet
 *     le compteur de tentatives à zéro ;
 *   - une étape qui échoue est rejouée deux fois, puis le job échoue avec une
 *     erreur lisible ; une erreur « sans reprise » échoue tout de suite ;
 *   - une annulation pendant l'étape n'est jamais écrasée par la fin d'étape ;
 *   - au-delà de 3 jobs running, un nouveau job attend en file ;
 *   - la migration reste additive, idempotente, et réserve claim_job au serveur.
 *
 * La fonction SQL `claim_job` est simulée ici en JS (même règles) ; elle a été
 * éprouvée contre un vrai Postgres 16, voir lib/jobs/README.md.
 *
 * Exécution : `npm run test:jobs`.
 */
import { readFileSync } from "node:fs";
import { FakeDb } from "./fake-supabase";
import { checkMigration } from "./check-migrations";
import { JobError, driveJob, failureDecision, runClaimedStep, type Db, type JobHandler } from "../lib/jobs/runner";
import { clampFanout } from "../lib/jobs/dispatch";
import { fromScan } from "../lib/jobs/handlers/search-shared";
import { clampDays, signalsParamsError } from "../lib/jobs/handlers/signals";
import { authorizeCron } from "../lib/trash/cron-auth";
import { EMPTY_PROGRESS, MAX_ATTEMPTS, type JobRow, type JobType } from "../lib/jobs/types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** FakeDb + une réplique JS de `claim_job` (supabase/migrations/…_jobs.sql). */
class JobsDb extends FakeDb {
  async rpc(name: string, args: { p_job_id: string | null; p_lease_seconds: number; p_max_running: number }) {
    if (name !== "claim_job") throw new Error(`rpc inconnue : ${name}`);
    const now = Date.now();
    const rows = this.rows("jobs");
    const free = (row: Record<string, unknown>) =>
      !row.locked_until || Date.parse(String(row.locked_until)) < now;
    const running = (user: unknown) => rows.filter((row) => row.user_id === user && row.status === "running").length;
    const candidates = rows
      .filter((row) => !args.p_job_id || row.id === args.p_job_id)
      .filter(free)
      .filter((row) => row.status === "running" || (row.status === "queued" && running(row.user_id) < args.p_max_running))
      .sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || String(a.created_at).localeCompare(String(b.created_at)));
    const picked = candidates[0];
    if (!picked) return { data: [], error: null };
    Object.assign(picked, {
      status: "running",
      started_at: picked.started_at ?? new Date(now).toISOString(),
      locked_until: new Date(now + args.p_lease_seconds * 1000).toISOString(),
      attempts: Number(picked.attempts) + 1,
    });
    return { data: [{ ...picked }], error: null };
  }
}

let sequence = 0;
function job(db: JobsDb, over: Partial<JobRow> = {}): JobRow {
  sequence += 1;
  const row: JobRow = {
    id: `job-${sequence}`,
    user_id: "u1",
    type: "reanalyze",
    target: { label: "test" },
    params: {},
    status: "queued",
    progress: EMPTY_PROGRESS,
    result: {},
    error: null,
    attempts: 0,
    locked_until: null,
    seen_at: null,
    created_at: new Date(Date.UTC(2026, 8, 26, 0, 0, sequence)).toISOString(),
    started_at: null,
    finished_at: null,
    step: 0,
    state: {},
    ...over,
  };
  db.from("jobs");
  db.tables.jobs.push(row as unknown as Record<string, unknown>);
  return row;
}

const handlersWith = (handler: JobHandler) =>
  ({ search_criteria: handler, search_signals: handler, email_generate: handler, email_rewrite: handler, reanalyze: handler }) as Record<JobType, JobHandler>;
const asDb = (db: JobsDb) => db as unknown as Db;
const row = (db: JobsDb, id: string) => db.rows("jobs").find((item) => item.id === id) as unknown as JobRow;

async function main() {
  console.log("failureDecision");
  check("1re tentative ratée → reprise", failureDecision(1, new Error("x")).verdict === "retry");
  check("2e tentative ratée → reprise", failureDecision(2, new Error("x")).verdict === "retry");
  const last = failureDecision(MAX_ATTEMPTS, new Error("Linkup 503"));
  check("3e tentative ratée → échec", last.verdict === "failed");
  check("message lisible", last.message === "Échec après 3 tentatives : Linkup 503", last.message);
  const fatal = failureDecision(1, new JobError("Prospect introuvable.", false, 404));
  check("JobError sans reprise → échec immédiat", fatal.verdict === "failed" && fatal.httpStatus === 404);
  check("message d'une JobError conservé tel quel", fatal.message === "Prospect introuvable.");

  console.log("chaîne d'étapes");
  {
    const db = new JobsDb();
    const seen: number[] = [];
    const handler: JobHandler = {
      steps: [
        async (ctx) => {
          seen.push(ctx.job.step);
          return { state: { contact: "c" }, result: { prospectIds: ["p1"] } };
        },
        async (ctx) => {
          seen.push(ctx.job.step);
          check("le point de reprise de l'étape 1 est lu à l'étape 2", ctx.job.state.contact === "c");
          return { state: { brief: "b" }, result: { messageId: "m1" }, progress: { ...EMPTY_PROGRESS, pct: 100 } };
        },
      ],
    };
    const created = job(db);
    const final = await driveJob(asDb(db), created.id, handlersWith(handler), 5_000);
    check("job terminé", final?.status === "done", final?.status);
    check("étapes jouées dans l'ordre", seen.join(",") === "0,1", seen.join(","));
    check("state fusionné", final?.state.contact === "c" && final?.state.brief === "b");
    check("result fusionné", final?.result.messageId === "m1" && final?.result.prospectIds?.[0] === "p1");
    check("tentatives remises à zéro", final?.attempts === 0);
    check("bail libéré", final?.locked_until === null);
    check("finished_at posé", Boolean(final?.finished_at));
  }

  console.log("reprises");
  {
    const db = new JobsDb();
    let calls = 0;
    const flaky: JobHandler = {
      steps: [
        async () => {
          calls += 1;
          if (calls < 3) throw new Error("timeout");
          return {};
        },
      ],
    };
    const created = job(db);
    const final = await driveJob(asDb(db), created.id, handlersWith(flaky), 5_000);
    check("2 échecs puis succès → done", final?.status === "done" && calls === 3, `${final?.status} ${calls}`);

    let failedWith = "";
    const broken: JobHandler = {
      steps: [async () => { throw new Error("Linkup 503"); }],
      onFailed: async (_ctx, message) => { failedWith = message; },
    };
    const doomed = job(db);
    const lost = await driveJob(asDb(db), doomed.id, handlersWith(broken), 5_000);
    check("3 échecs → failed", lost?.status === "failed", lost?.status);
    check("erreur lisible en base", lost?.error === "Échec après 3 tentatives : Linkup 503", lost?.error ?? "");
    check("onFailed appelé (ligne search_runs close)", failedWith === lost?.error);

    const fatal: JobHandler = { steps: [async () => { throw new JobError("Prospect introuvable.", false, 404); }] };
    const missing = job(db);
    const gone = await driveJob(asDb(db), missing.id, handlersWith(fatal), 5_000);
    check("erreur sans reprise → failed dès la 1re tentative", gone?.status === "failed" && gone?.attempts === 1);
    check("statut HTTP gardé pour la route", gone?.state.httpStatus === 404);
  }

  console.log("annulation");
  {
    const db = new JobsDb();
    let sawCancel = false;
    const created = job(db);
    const slow: JobHandler = {
      steps: [
        async (ctx) => {
          row(db, created.id).status = "cancelled";
          sawCancel = await ctx.isCancelled();
          return { result: { runId: "r1" } };
        },
      ],
    };
    const claimed = (await db.rpc("claim_job", { p_job_id: created.id, p_lease_seconds: 315, p_max_running: 3 })).data[0] as unknown as JobRow;
    const verdict = await runClaimedStep(asDb(db), claimed, handlersWith(slow));
    check("l'étape voit l'annulation", sawCancel);
    check("verdict cancelled", verdict === "cancelled", verdict);
    check("la fin d'étape n'écrase pas l'annulation", row(db, created.id).status === "cancelled");
  }

  console.log("concurrence");
  {
    const db = new JobsDb();
    const now = new Date(Date.now() + 60_000).toISOString();
    for (let i = 0; i < 3; i += 1) job(db, { status: "running", locked_until: now });
    const waiting = job(db);
    const noop: JobHandler = { steps: [async () => ({})] };
    const outcome = await driveJob(asDb(db), waiting.id, handlersWith(noop), 5_000, { returnIfQueued: true });
    check("4e job laissé en file", outcome?.status === "queued", outcome?.status);

    const stale = job(db, { status: "running", locked_until: new Date(Date.now() - 1_000).toISOString(), attempts: 1 });
    const retaken = (await db.rpc("claim_job", { p_job_id: null, p_lease_seconds: 315, p_max_running: 3 })).data[0];
    check("un job au bail expiré est repris en priorité", retaken?.id === stale.id, String(retaken?.id));
    check("la reprise compte une tentative", retaken?.attempts === 2);
  }

  console.log("utilitaires");
  check("fanout absent → 0", clampFanout(undefined) === 0);
  check("fanout borné à 6", clampFanout(50) === 6);
  check("fanout 3", clampFanout(3) === 3);
  const pct = fromScan({ phase: "fiches", pagesRead: 4, pagesPlanned: 4, scanned: 30, withSignal: 5, analysed: 3, analysedPlanned: 3, step: "fin" });
  check("scan fini → 100 %", pct.pct === 100, String(pct.pct));
  check("compteurs du scan", pct.counts.scanned === 30 && pct.counts.signals === 5 && pct.counts.sheets === 3);
  check("département invalide refusé", signalsParamsError({ departement: "999", size: "petite" }) !== null);
  check("département corse accepté", signalsParamsError({ departement: "2a", size: "petite" }) === null);
  check("fenêtre bornée à 90 j", clampDays(365) === 90);
  check("secret du tick exigé", !authorizeCron("Bearer x", undefined));
  check("mauvais secret refusé", !authorizeCron("Bearer faux", "vrai"));
  check("bon secret accepté", authorizeCron("Bearer vrai", "vrai"));

  console.log("migration");
  const file = "supabase/migrations/20260926180133_jobs.sql";
  const sql = readFileSync(file, "utf8");
  check("aucune opération destructive", checkMigration(file, sql).length === 0);
  check("table idempotente", /create table if not exists public\.jobs/.test(sql));
  check("policy recréée proprement", /drop policy if exists "jobs_owner"/.test(sql));
  check("GRANT authenticated avec la policy", /grant select, insert, update on public\.jobs to authenticated/.test(sql));
  check("prise sous verrou", /for update skip locked/.test(sql));
  check("claim_job refusé aux utilisateurs", /revoke execute on function public\.claim_job\(uuid, int, int\) from anon, authenticated/.test(sql));
  check("aucun secret en dur dans le cron", /vault\.decrypted_secrets/.test(sql) && !/Bearer [A-Za-z0-9]{16,}/.test(sql));

  if (failures) {
    console.log(`\n${failures} échec(s).`);
    process.exit(1);
  }
  console.log("\nTous les tests jobs passent.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
