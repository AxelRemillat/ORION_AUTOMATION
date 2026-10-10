"use client";

import Link from "next/link";
import { Badge, Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui";
import { formatDate, formatEur } from "@/lib/utils";
import { TrashButton } from "@/components/trash/trash-button";
import { STAGE_TONE_VARS, stageOf } from "../_lib/stages";
import { ShowMore, useShowMore } from "./show-more";
import type { ProspectRow } from "../_lib/rows";

/**
 * Vue tableau du pipeline : dense, balayable, une ligne par prospect.
 *
 * Vingt-cinq lignes d'abord, les plus récentes en haut, puis « Afficher plus ».
 * La recherche et le filtre d'étape s'appliquent en amont (pipeline-board) :
 * une fiche trouvée apparaît même si elle était au-delà des vingt-cinq.
 */
export function ProspectTable({ rows }: { rows: ProspectRow[] }) {
  const sorted = [...rows].sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
  const { visible, rest, more } = useShowMore(sorted.length, 25);

  return (
    <Table>
      <THead>
        <TR>
          <TH>Entreprise</TH>
          <TH>Étape</TH>
          <TH>Valeur</TH>
          <TH>Prochaine action</TH>
          <TH>Dernière activité</TH>
          <TH>
            <span className="sr-only">Actions</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {sorted.length === 0 && (
          <TableEmpty colSpan={6}>Aucun prospect ne correspond à ce filtre.</TableEmpty>
        )}
        {sorted.slice(0, visible).map((row) => {
          const stage = stageOf(row.status);
          const tone = STAGE_TONE_VARS[stage.tone];
          return (
            <TR key={row.id}>
              <TD>
                <Link href={`/suivi/${row.id}`} className="font-medium hover:text-primary">
                  {row.company_name}
                </Link>
                <p className="text-[12px] text-faint">
                  {[row.sector, row.city].filter(Boolean).join(" · ") || "—"}
                </p>
                {row.unreachable && (
                  <Badge tone="neutral" className="mt-1" title={row.unreachable}>
                    Non joignable
                  </Badge>
                )}
              </TD>
              <TD>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: tone.soft, color: tone.accent }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: tone.accent }}
                    aria-hidden
                  />
                  {stage.label}
                </span>
              </TD>
              <TD className="font-data text-[13px] text-muted" title={row.value.basis}>
                {formatEur(row.value.amount)}
              </TD>
              <TD className="text-[13px] text-muted">
                {row.action.label}
                {row.action.dueAt && (
                  <span className="font-data ml-1.5 text-[11px] text-faint">
                    {formatDate(row.action.dueAt)}
                  </span>
                )}
                {row.draftsCount > 0 && (
                  <Badge tone="warning" className="ml-2">
                    {row.draftsCount} brouillon{row.draftsCount > 1 ? "s" : ""}
                  </Badge>
                )}
              </TD>
              <TD className="font-data text-[13px] text-faint">{formatDate(row.lastActivity)}</TD>
              <TD className="text-right">
                <TrashButton prospectId={row.id} companyName={row.company_name} />
              </TD>
            </TR>
          );
        })}
        {rest > 0 && (
          <TR>
            <TD colSpan={6}>
              <ShowMore rest={rest} onMore={more} />
            </TD>
          </TR>
        )}
      </TBody>
    </Table>
  );
}
