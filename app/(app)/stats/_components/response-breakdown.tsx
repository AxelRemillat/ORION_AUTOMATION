"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { RateBars } from "../_charts/rate-bars";
import type { Breakdown } from "../_lib/metrics";

type TabKey = "sector" | "sequence" | "signal";

const TABS: { key: TabKey; label: string }[] = [
  { key: "sector", label: "Secteur" },
  { key: "sequence", label: "Séquence" },
  { key: "signal", label: "Signal" },
];

/** Taux de réponse selon trois axes de lecture, un onglet chacun. */
export function ResponseBreakdown({
  bySector,
  bySequence,
  bySignal,
}: {
  bySector: Breakdown[];
  bySequence: Breakdown[];
  bySignal: Breakdown[];
}) {
  const [tab, setTab] = useState<TabKey>("sector");
  const rows = tab === "sector" ? bySector : tab === "sequence" ? bySequence : bySignal;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Taux de réponse</CardTitle>
        <CardDescription>
          Sur les prospects réellement contactés. L&apos;effectif est rappelé à droite de chaque
          barre.
        </CardDescription>

        <div
          className="mt-3 flex items-center gap-1 border-b"
          style={{ borderColor: "var(--line-soft)" }}
          role="tablist"
          aria-label="Axe d'analyse"
        >
          {TABS.map((item) => {
            const active = item.key === tab;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.key)}
                className={`relative px-3 py-2 text-[13px] transition-colors ${
                  active ? "text-text" : "text-muted hover:text-text"
                }`}
              >
                {item.label}
                {/* Soulignage dégradé de l'onglet actif — signature de la palette. */}
                {active && (
                  <span
                    className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-brand-grad"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent>
        <RateBars
          rows={rows}
          emptyLabel="Pas encore assez de prospects contactés pour ce découpage."
        />
      </CardContent>
    </Card>
  );
}
