import type { FunnelSnapshot } from "@/lib/funnel/latest";

/**
 * Bandeau du run : l'entonnoir chiffré (bruts → filtrés → retenus →
 * contactables), l'avancement du job et ce que le run a coûté.
 */

const STEPS = [
  ["bruts", "bruts"],
  ["filtres", "filtrés"],
  ["retenus", "retenus"],
  ["contactables", "contactables"],
] as const;

const euros = (value: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value);

export function FunnelBanner({ snapshot }: { snapshot: FunnelSnapshot }) {
  const { job, counts, cost, readyShare } = snapshot;
  if (!job) return null;
  const running = job.status === "queued" || job.status === "running";
  const pct = Math.max(0, Math.min(100, job.progress?.pct ?? 0));

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-mist">
      <div className="flex flex-wrap items-center gap-2 font-data text-[13px]">
        {STEPS.map(([key, label], index) => (
          <span key={key} className="flex items-center gap-2">
            {index > 0 && <span className="text-faint">→</span>}
            <span className="text-text">{counts[key]}</span>
            <span className="text-muted">{label}</span>
          </span>
        ))}
        <span className="ml-auto text-muted">
          {cost ? `coût ${euros(cost.eur)} · ${cost.pappers} Pappers · ${cost.hunter} Hunter` : "coût en cours de calcul"}
        </span>
      </div>
      {running && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="bg-brand-grad h-full rounded-full motion-safe:transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[12px] text-muted">{job.progress?.step ?? "En file"}</p>
        </div>
      )}
      {!running && (
        <p className="mt-2 text-[12px] text-muted">
          {job.status === "failed" ? `Échec : ${job.error ?? "inconnu"}` : `Run du ${new Date(job.created_at).toLocaleString("fr-FR")}`}
          {readyShare != null && (
            <span className={readyShare >= 0.6 ? "text-good-ink" : "text-warn-ink"}>
              {` · ${Math.round(readyShare * 100)} % des fiches creusées ont un signal daté et un email (objectif 60 %)`}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
