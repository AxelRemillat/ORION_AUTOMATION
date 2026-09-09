"use client";

import { useMemo, useState } from "react";
import { Card, Input, ProspectStatusBadge } from "@/components/ui";
import type { Prospect } from "@/types";

/** Colonne de gauche : sélection du prospect à travailler, avec filtre texte. */
export function ProspectPicker({
  prospects,
  selectedId,
  onSelect,
}: {
  prospects: Prospect[];
  selectedId: string | null;
  onSelect: (prospect: Prospect) => void;
}) {
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return prospects;
    return prospects.filter((prospect) =>
      [prospect.company_name, prospect.city, prospect.sector]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(needle)),
    );
  }, [prospects, filter]);

  return (
    <Card className="flex max-h-[calc(100vh-13rem)] flex-col overflow-hidden">
      <div className="border-b border-line p-3">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filtrer par nom, ville, secteur"
          aria-label="Filtrer les prospects"
        />
      </div>

      <ul className="scrollbar-thin flex-1 overflow-y-auto">
        {visible.map((prospect) => {
          const active = prospect.id === selectedId;
          return (
            <li key={prospect.id}>
              <button
                type="button"
                onClick={() => onSelect(prospect)}
                aria-current={active ? "true" : undefined}
                className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${
                  active
                    ? "border-primary bg-surface-2"
                    : "border-transparent hover:bg-surface-2/60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-medium leading-snug text-text">
                    {prospect.company_name}
                  </span>
                  <ProspectStatusBadge status={prospect.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-faint">
                  {[prospect.sector, prospect.city].filter(Boolean).join(" · ") || "—"}
                </p>
              </button>
            </li>
          );
        })}

        {!visible.length && (
          <li className="px-4 py-6 text-center text-[13px] text-faint">Aucun prospect ne correspond.</li>
        )}
      </ul>
    </Card>
  );
}
