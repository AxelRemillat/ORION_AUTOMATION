"use client";

import { useMemo, useState } from "react";
import { Columns3, Rows3, Search } from "lucide-react";
import { Button, EmptyState, Input, Select } from "@/components/ui";
import { STAGES } from "../_lib/stages";
import { PipelineKanban } from "./pipeline-kanban";
import { ProspectTable } from "./prospect-table";
import { useOptimisticStatus } from "./use-optimistic-status";
import type { ProspectRow } from "../_lib/rows";

type View = "kanban" | "table";

/** Pipeline complet : recherche, filtre par étape, bascule colonnes / tableau. */
export function PipelineBoard({ rows: serverRows }: { rows: ProspectRow[] }) {
  // Statuts optimistes appliqués AVANT filtre et vues : colonne, filtre par
  // étape et tableau suivent la carte dès le dépôt.
  const { rows, move } = useOptimisticStatus(serverRows);
  const [view, setView] = useState<View>("kanban");
  const [stage, setStage] = useState<string>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (stage !== "all" && row.stageKey !== stage) return false;
      if (!needle) return true;
      return [row.company_name, row.sector, row.city]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(needle));
    });
  }, [rows, stage, query]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Aucun prospect à suivre"
        description="Les prospects ajoutés depuis la Recherche apparaissent ici avec leurs messages, leur valeur et leur prochaine action."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
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

        <div className="w-48">
          <Select
            value={stage}
            onChange={(event) => setStage(event.target.value)}
            aria-label="Filtrer par étape"
          >
            <option value="all">Toutes les étapes</option>
            {STAGES.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={view === "kanban" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("kanban")}
            aria-pressed={view === "kanban"}
          >
            <Columns3 className="h-3.5 w-3.5" aria-hidden />
            Colonnes
          </Button>
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("table")}
            aria-pressed={view === "table"}
          >
            <Rows3 className="h-3.5 w-3.5" aria-hidden />
            Table
          </Button>
        </div>
      </div>

      {view === "kanban" ? <PipelineKanban rows={filtered} onMove={move} /> : <ProspectTable rows={filtered} />}
    </div>
  );
}
