"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/ui";
import { JOBS_CHANGED, fetchActiveJobs, isActive, markJobSeen } from "@/lib/jobs/client";
import type { Job } from "@/lib/jobs/types";

/** Cadence de sondage : serrée quand un job tourne, lâche sinon. */
const BUSY_MS = 3_000;
const IDLE_MS = 20_000;

/** Où mène l'indicateur : l'écran qui montre le résultat du job. */
export function jobHref(job: Pick<Job, "type" | "target">): string {
  if (job.type === "search_criteria" || job.type === "search_signals") return "/recherche";
  const prospectId = job.target?.prospectId;
  return prospectId ? `/prospection?prospect=${encodeURIComponent(prospectId)}` : "/prospection";
}

/**
 * Indicateur « tâches en cours », sur TOUTES les pages, /recherche comprise.
 *
 * Il lit la table `jobs` et non plus `search_runs` : il couvre donc aussi la
 * génération de mails, et il ne disparaît plus au milieu d'un long lot de scan.
 * Quand un job se termine, un toast le dit — y compris s'il s'est terminé
 * pendant que l'app était fermée — puis le job est marqué « vu ».
 */
export function JobsIndicator() {
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const announced = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback(
    (job: Job) => {
      if (announced.current.has(job.id)) return;
      announced.current.add(job.id);
      const label = job.target?.label ?? "Tâche";
      if (job.status === "done") toast.success(`Terminé : ${label}`);
      else if (job.status === "failed") toast.error(`Échec : ${label}${job.error ? ` — ${job.error}` : ""}`);
      void markJobSeen(job.id);
    },
    [toast],
  );

  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    let busy = false;
    if (!document.hidden) {
      try {
        const list = await fetchActiveJobs();
        list.filter((job) => !isActive(job)).forEach(announce);
        const active = list.filter(isActive);
        busy = active.length > 0;
        setJobs(active);
      } catch {
        // Réseau coupé : on garde l'état connu, le prochain tour réessaiera.
      }
    }
    timer.current = setTimeout(poll, busy ? BUSY_MS : IDLE_MS);
  }, [announce]);

  useEffect(() => {
    void poll();
    const wake = () => void poll();
    const onVisible = () => !document.hidden && wake();
    window.addEventListener(JOBS_CHANGED, wake);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener(JOBS_CHANGED, wake);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  if (!jobs.length) return null;
  const first = jobs[0];
  const running = jobs.filter((job) => job.status === "running").length;
  const text =
    jobs.length === 1
      ? `${first.target?.label ?? "Tâche"}${first.status === "queued" ? " · en file" : ""}`
      : `${jobs.length} tâches${running < jobs.length ? ` · ${jobs.length - running} en file` : ""}`;

  return (
    <Link
      href={jobHref(first)}
      title={first.progress?.step ?? undefined}
      className="inline-flex max-w-[280px] items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[12px] font-medium text-primary-ink motion-safe:transition-colors hover:bg-primary/15"
    >
      <Loader2 className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />
      <span className="truncate">{text}</span>
      {jobs.length === 1 && first.status === "running" && (
        <span className="font-data tabular-nums">{Math.round(first.progress?.pct ?? 0)} %</span>
      )}
    </Link>
  );
}
