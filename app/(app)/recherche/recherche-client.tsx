"use client";

import { useState } from "react";
import { Building2, SearchX } from "lucide-react";
import { Card, CardContent, EmptyState, Skeleton, useToast } from "@/components/ui";
import { ApiError, postJson } from "@/lib/enrichment/api-client";
import type { EnrichedCompany, EnrichmentWarning } from "@/lib/enrichment/types";
import { ErrorBanner, WarningBanner } from "./banners";
import { ManualForm } from "./manual-form";
import { ResultCard, type AddState } from "./result-card";
import { SearchForm, type SearchCriteriaInput } from "./search-form";

type Mode = "auto" | "manuel";

interface SearchResponse {
  results: EnrichedCompany[];
  total: number;
  warnings: EnrichmentWarning[];
}

/** Identifie une carte de façon stable entre deux rendus. */
const keyOf = (company: EnrichedCompany) => company.siren ?? company.company_name;

export function RechercheClient() {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("auto");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<EnrichedCompany[]>([]);
  const [warnings, setWarnings] = useState<EnrichmentWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addStates, setAddStates] = useState<Record<string, AddState>>({});

  /** Enveloppe commune aux deux modes : reset, appel, gestion d'erreur. */
  async function run(request: () => Promise<{ results: EnrichedCompany[]; warnings: EnrichmentWarning[] }>) {
    setLoading(true);
    setError(null);
    try {
      const data = await request();
      setResults(data.results);
      setWarnings(data.warnings);
      setAddStates({});
    } catch (cause) {
      setResults([]);
      setWarnings([]);
      setError(cause instanceof Error ? cause.message : "Recherche impossible.");
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }

  const searchAuto = (criteria: SearchCriteriaInput) =>
    run(async () => {
      const data = await postJson<SearchResponse>("/api/prospects/search", criteria);
      return { results: data.results, warnings: data.warnings };
    });

  const searchManual = (query: string) =>
    run(async () => {
      const data = await postJson<{ result: EnrichedCompany }>("/api/prospects/enrich", { query });
      return { results: [data.result], warnings: data.result.warnings };
    });

  async function addProspect(company: EnrichedCompany) {
    const key = keyOf(company);
    setAddStates((current) => ({ ...current, [key]: "loading" }));
    try {
      await postJson("/api/prospects", { company, source: mode === "auto" ? "auto" : "import" });
      setAddStates((current) => ({ ...current, [key]: "added" }));
      toast.success(`${company.company_name} ajouté à vos prospects.`);
    } catch (cause) {
      const duplicate = cause instanceof ApiError && cause.status === 409;
      setAddStates((current) => ({ ...current, [key]: duplicate ? "duplicate" : "idle" }));
      toast.error(cause instanceof Error ? cause.message : "Ajout impossible.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex gap-1 border-b border-border px-3 pt-3">
          {(["auto", "manuel"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-t px-3 py-2 text-[13px] font-medium transition-colors ${
                mode === value
                  ? "border-b-2 border-accent text-fg"
                  : "border-b-2 border-transparent text-muted hover:text-fg"
              }`}
            >
              {value === "auto" ? "Recherche par critères" : "Ajout manuel"}
            </button>
          ))}
        </div>
        <CardContent className="pt-5">
          {mode === "auto" ? (
            <SearchForm onSubmit={searchAuto} loading={loading} />
          ) : (
            <ManualForm onSubmit={searchManual} loading={loading} />
          )}
        </CardContent>
      </Card>

      {error && <ErrorBanner message={error} />}
      <WarningBanner warnings={warnings} />

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-64" />
          ))}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {results.map((company) => (
            <ResultCard
              key={keyOf(company)}
              company={company}
              state={addStates[keyOf(company)] ?? "idle"}
              onAdd={addProspect}
            />
          ))}
        </div>
      )}

      {!loading && searched && !results.length && !error && (
        <EmptyState
          icon={<SearchX />}
          title="Aucune entreprise trouvée"
          description="Élargissez la zone géographique ou retirez un critère."
        />
      )}

      {!loading && !searched && (
        <EmptyState
          icon={<Building2 />}
          title="Lancez une recherche"
          description="Croisez un secteur, une taille et une zone, ou collez directement un nom, un SIREN ou une URL."
        />
      )}
    </div>
  );
}
