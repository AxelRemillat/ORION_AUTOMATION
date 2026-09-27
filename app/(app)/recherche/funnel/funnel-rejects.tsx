import type { FunnelReject } from "@/lib/funnel/view";

/**
 * Rejets du run, repliés : un tableau des motifs (ce qui rend l'entonnoir
 * mesurable), puis la liste détaillée. Rien n'est facturé pour un rejet.
 */
export function FunnelRejects({ rejects }: { rejects: FunnelReject[] }) {
  if (!rejects.length) return null;
  const byReason = new Map<string, number>();
  for (const reject of rejects) {
    // « augmentation de capital marginale (+959,76 €) » → un seul motif.
    const key = reject.reason.replace(/\s*\([^)]*\)/g, "").split(" : ")[0];
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <details className="rounded-lg border border-line bg-surface p-4">
      <summary className="cursor-pointer text-[13px] text-muted">
        {rejects.length} signal{rejects.length > 1 ? "aux" : ""} écarté{rejects.length > 1 ? "s" : ""}, avec leur motif
      </summary>
      <ul className="mt-3 grid gap-1 text-[13px] md:grid-cols-2">
        {reasons.map(([reason, count]) => (
          <li key={reason} className="flex justify-between gap-3">
            <span className="text-muted">{reason}</span>
            <span className="font-data text-text">{count}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-4 flex flex-col divide-y divide-line-soft text-[12px]">
        {rejects.map((reject) => (
          <li key={reject.id} className="flex flex-wrap gap-x-3 py-1.5">
            <span className="text-text">{reject.companyName}</span>
            <span className="font-data text-faint">
              {reject.source} · {reject.date ?? "—"}
            </span>
            <span className="text-muted">{reject.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
