import { History, ListChecks } from "lucide-react";
import { searchReport, type StoredSearch } from "@/lib/contact-finder/report";
import { formatDateTime } from "@/lib/utils";

/**
 * « Recherches effectuées » : ce que le module contact a cherché, lu et payé.
 *
 * Replié quand une adresse a été trouvée, OUVERT quand la recherche a échoué :
 * c'est là qu'on a besoin de savoir s'il faut insister, saisir le site à la
 * main ou conclure qu'il n'existe pas. Le texte est déterministe
 * (lib/contact-finder/report.ts), relu depuis le journal enregistré.
 */
export function SearchReport({ search }: { search: unknown }) {
  const stored = (search ?? null) as StoredSearch | null;
  const report = searchReport(stored);
  if (!report) return null;
  const history = stored?.history ?? [];

  return (
    <details open={report.failed} className="group rounded-lg border border-line-soft bg-surface-2/60 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[12px] text-muted">
        <span className="flex items-center gap-1.5 font-medium text-text">
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
          Recherches effectuées
        </span>
        {report.checkedAt && <span className="font-data text-[11px] text-faint">{formatDateTime(report.checkedAt)}</span>}
      </summary>

      <p className={`mt-2 text-[12.5px] font-medium ${report.failed ? "text-warn-ink" : "text-good-ink"}`}>
        {report.conclusion}
      </p>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-muted">
        {report.lines.map((line, index) => (
          <li key={index} className="break-words">
            {line}
          </li>
        ))}
      </ul>

      {history.length > 0 && (
        <div className="mt-2 border-t border-line-soft pt-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-faint">
            <History className="h-3 w-3" aria-hidden /> Recherches précédentes
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-[11.5px] text-muted">
            {history.map((item) => (
              <li key={item.checked_at}>
                <span className="font-data text-faint">{formatDateTime(item.checked_at)}</span> — {item.conclusion}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
