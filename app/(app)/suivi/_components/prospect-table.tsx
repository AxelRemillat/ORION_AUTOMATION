"use client";

import Link from "next/link";
import { Badge, ProspectStatusBadge, Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import type { ProspectRow } from "../_lib/rows";

/** Vue tableau du pipeline : dense, triable à l'œil, une ligne par prospect. */
export function ProspectTable({ rows }: { rows: ProspectRow[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Entreprise</TH>
          <TH>Statut</TH>
          <TH>Messages</TH>
          <TH>Dernière activité</TH>
          <TH>Relance</TH>
        </TR>
      </THead>
      <TBody>
        {rows.length === 0 && (
          <TableEmpty colSpan={5}>Aucun prospect ne correspond à ce filtre.</TableEmpty>
        )}
        {rows.map((row) => (
          <TR key={row.id}>
            <TD>
              <Link href={`/suivi/${row.id}`} className="font-medium hover:text-accent">
                {row.company_name}
              </Link>
              <p className="text-[12px] text-muted">
                {[row.sector, row.city].filter(Boolean).join(" · ") || "—"}
              </p>
            </TD>
            <TD>
              <ProspectStatusBadge status={row.status} />
            </TD>
            <TD className="tabular-nums text-muted">
              {row.messagesCount}
              {row.draftsCount > 0 && (
                <Badge tone="warning" className="ml-2">
                  {row.draftsCount} brouillon{row.draftsCount > 1 ? "s" : ""}
                </Badge>
              )}
            </TD>
            <TD className="text-[13px] text-muted">{formatDate(row.lastActivity)}</TD>
            <TD className="text-[13px] text-muted">
              {row.nextDueAt ? formatDate(row.nextDueAt) : "—"}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
