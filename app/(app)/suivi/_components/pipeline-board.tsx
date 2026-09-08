"use client";

import { useMemo, useState } from "react";
import { Columns3, Rows3, Search } from "lucide-react";
import { Button, EmptyState, Input, Select } from "@/components/ui";
import { PIPELINE_ORDER, PROSPECT_STATUS_META } from "@/lib/constants";
import type { ProspectStatus } from "@/types";
import { PipelineKanban } from "./pipeline-kanban";
import { ProspectTable } from "./prospect-table";
import type { ProspectRow } from "../_lib/rows";

type View = "table" | "kanban";

/** Pipeline complet : recherche, filtre par statut, bascule tableau / colonnes. */
export function PipelineBoard({ rows }: { rows: ProspectRow[] }) {
  const [view, setView] = useState<View>("table");
  const [status, setStatus] = useState<ProspectStatus | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (!needle) return true;
      return [row.company_name, row.sector, row.city]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(needle));
    });
  }, [rows, status, query]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Aucun prospect à suivre"
        description="Les prospects ajoutés depuis la Recherche apparaîtront ici, avec leurs messages et leurs relances."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher une entreprise…"
            aria-label="Rechercher un prospect"
            className="pl-9"
          />
        </div>

        <div className="w-44">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as ProspectStatus | "all")}
            aria-label="Filtrer par statut"
          >
            <option value="all">Tous les statuts</option>
            {PIPELINE_ORDER.map((value) => (
              <option key={value} value={value}>
                {PROSPECT_STATUS_META[value].label}
              </option>
            ))}
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("table")}
            aria-pressed={view === "table"}
          >
            <Rows3 className="h-3.5 w-3.5" aria-hidden />
            Table
          </Button>
          <Button
            variant={view === "kanban" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("kanban")}
            aria-pressed={view === "kanban"}
          >
            <Columns3 className="h-3.5 w-3.5" aria-hidden />
            Colonnes
          </Button>
        </div>
      </div>

      {view === "table" ? <ProspectTable rows={filtered} /> : <PipelineKanban rows={filtered} />}
    </div>
  );
}
