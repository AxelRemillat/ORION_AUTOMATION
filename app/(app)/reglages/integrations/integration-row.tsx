"use client";

import { useState, useTransition } from "react";
import { PlugZap } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import type { IntegrationStatus, TestResult } from "@/lib/settings/integrations";
import { testIntegrationAction } from "../actions";

/** Une intégration : état, dernier appel réussi, et « Tester » quand un appel gratuit existe. */

const TONE = { connecté: "success", "clé manquante": "danger", "jamais appelé": "warning", "non utilisé": "neutral" } as const;

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })
    : "—";

export function IntegrationRow({ item }: { item: IntegrationStatus }) {
  const [result, setResult] = useState<TestResult | null>(null);
  const [pending, start] = useTransition();
  const run = () => start(async () => setResult(await testIntegrationAction(item.key)));

  return (
    <li className="flex flex-col gap-2 border-b border-line-soft py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium text-text">{item.label}</span>
          <Badge tone={result ? (result.ok ? "success" : "danger") : TONE[item.state]}>{result ? (result.ok ? "connecté" : "erreur") : item.state}</Badge>
        </div>
        <p className="mt-0.5 text-[12px] text-muted">
          {item.missing.length ? (
            <>Variables manquantes : <span className="font-data">{item.missing.join(", ")}</span></>
          ) : (
            <>Dernier appel réussi : <span className="font-data">{when(item.lastSuccess)}</span></>
          )}
        </p>
        {result && <p className={`mt-0.5 text-[12px] ${result.ok ? "text-good-ink" : "text-lost-ink"}`}>{result.detail}</p>}
      </div>
      {item.test ? (
        <Button size="sm" variant="outline" onClick={run} loading={pending} title={item.test} className="self-start sm:self-auto">
          <PlugZap className="h-3.5 w-3.5" aria-hidden />
          Tester
        </Button>
      ) : null}
    </li>
  );
}
