"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { startJob, watchJob } from "@/lib/jobs/client";
import type { Job } from "@/lib/jobs/types";

/**
 * « Lancer maintenant » : la même préparation que celle du matin, à la
 * demande. Grisé tant qu'une préparation tourne, avec son avancement ; la
 * file se recharge à la fin.
 */
export function RunNowButton({
  liveJobId,
  dailyTarget,
  onFinished,
}: {
  liveJobId: string | null;
  dailyTarget: number;
  onFinished: () => void;
}) {
  const toast = useToast();
  const [jobId, setJobId] = useState(liveJobId);
  const [job, setJob] = useState<Pick<Job, "progress" | "status"> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    void watchJob(jobId, { onUpdate: setJob, stopped: () => stopped, intervalMs: 4_000 })
      .then((snapshot) => {
        if (!snapshot) return;
        setJobId(null);
        setJob(null);
        if (snapshot.job.status === "failed") toast.error(snapshot.job.error ?? "Préparation interrompue.");
        else toast.success(snapshot.job.progress.step);
        onFinished();
      })
      .catch(() => setJobId(null));
    return () => {
      stopped = true;
    };
  }, [jobId, onFinished, toast]);

  async function start() {
    try {
      setJobId(await startJob("search_signals", { label: "Préparation du jour" }, { kind: "prepare", digLimit: dailyTarget, trigger: "manuel" }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Lancement impossible.");
    }
  }

  if (jobId) {
    const pct = job?.progress.pct ?? 0;
    return (
      <div className="flex min-w-[220px] flex-col gap-1" aria-live="polite">
        <Button size="sm" variant="outline" disabled loading>
          Préparation en cours · {pct} %
        </Button>
        <p className="max-w-[280px] truncate font-data text-[11px] text-faint">{job?.progress.step ?? "En file d'attente"}</p>
      </div>
    );
  }
  return (
    <Button size="sm" variant="outline" onClick={start}>
      <Play className="h-3.5 w-3.5" aria-hidden /> Lancer maintenant
    </Button>
  );
}
