"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, SearchX } from "lucide-react";
import { Card, CardContent, EmptyState, Skeleton, useToast } from "@/components/ui";
import { ApiError, postJson } from "@/lib/enrichment/api-client";
import { compareHeat, heatScore } from "@/lib/scoring";
import type { EnrichedCompany, EnrichmentWarning } from "@/lib/enrichment/types";
import { ErrorBanner, WarningBanner } from "./banners";
import { ManualForm } from "./manual-form";
import { ResultCard, type AddState } from "./result-card";
import { SavedSearches } from "./saved-searches";
import { SearchForm, type SearchCriteriaInput } from "./search-form";
import { SortToggle, type SortMode } from "./sort-toggle";

type Mode = "auto" | "manuel";

interface SearchResponse {
  results: EnrichedCompany[];
  total: number;
  warnings: EnrichmentWarning[];
}

/** Identifie une carte de façon stable entre deux rendus. */
const keyOf = (company: EnrichedCompany) => company.siren ?? company.company_name;

export function RechercheClient() {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("auto");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<EnrichedCompany[]>([]);
  const [warnings, setWarnings] = useState<EnrichmentWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addStates, setAddStates] = useState<Record<string, AddState>>({});
  const [sort, setSort] = useState<SortMode>("chaleur");
  const [lastCriteria, setLastCriteria] = useState<SearchCriteriaInput | null>(null);
  // Remonter le formulaire est le moyen le plus simple d'y injecter des critères.
  const [formSeed, setFormSeed] = useState(0);
  const [seedCriteria, setSeedCriteria] = useState<SearchCriteriaInput | undefined>();

  /** L'ordre de l'annuaire est la pertinence ; le score le réordonne à la demande. */
  const sorted = useMemo(() => {
    if (sort === "pertinence") return results;
    return [...results].sort((a, b) =>
      compareHeat(heatScore(a.signals, { seed: keyOf(a) }), heatScore(b.signals, { seed: keyOf(b) })),
    );
  }, [results, sort]);

  /** Enveloppe commune aux deux modes : reset, appel, gestion d'erreur. */
  async function run(
    request: () => Promise<{ results: EnrichedCompany[]; warnings: EnrichmentWarning[] }>,
  ) {
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

  const searchAuto = (criteria: SearchCriteriaInput) => {
    setLastCriteria(criteria);
    return run(async () => {
      const data = await postJson<SearchResponse>("/api/prospects/search", criteria);
      return { results: data.results, warnings: data.warnings };
    });
  };

  const searchManual = (query: string) => {
    setLastCriteria(null);
    return run(async () => {
      const data = await postJson<{ result: EnrichedCompany }>("/api/prospects/enrich", { query });
      return { results: [data.result], warnings: data.result.warnings };
    });
  };

  /** Rejoue une recherche sauvegardée : on réinjecte les critères puis on lance. */
  function applySaved(criteria: SearchCriteriaInput) {
    setMode("auto");
    setSeedCriteria(criteria);
    setFormSeed((current) => current + 1);
    void searchAuto(criteria);
  }

  /** Ajoute le prospect. Un doublon n'est pas un échec : la fiche existe déjà. */
  async function addProspect(company: EnrichedCompany): Promise<AddState> {
    const key = keyOf(company);
    const existing = addStates[key];
    if (existing === "added" || existing === "duplicate") return existing;

    setAddStates((current) => ({ ...current, [key]: "loading" }));
    try {
      await postJson("/api/prospects", { company, source: mode === "auto" ? "auto" : "import" });
      setAddStates((current) => ({ ...current, [key]: "added" }));
      toast.success(`${company.company_name} ajouté à vos prospects.`);
      return "added";
    } catch (cause) {
      const duplicate = cause instanceof ApiError && cause.status === 409;
      setAddStates((current) => ({ ...current, [key]: duplicate ? "duplicate" : "idle" }));
      toast.error(cause instanceof Error ? cause.message : "Ajout impossible.");
      return duplicate ? "duplicate" : "idle";
    }
  }

  /** 1-clic : on s'assure que le prospect existe, puis on ouvre la Prospection. */
  async function prospect(company: EnrichedCompany) {
    const state = await addProspect(company);
    if (state === "added" || state === "duplicate") router.push("/prospection");
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div
          className="flex gap-1 border-b px-3 pt-3"
          style={{ borderColor: "var(--line-soft)" }}
          role="tablist"
        >
          {(["auto", "manuel"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className="relative rounded-t px-3 py-2 text-[13px] font-medium motion-safe:transition-colors"
              style={{ color: mode === value ? "var(--text)" : "var(--muted)" }}
            >
              {value === "auto" ? "Recherche par critères" : "Ajout manuel"}
              {mode === value && (
                <span
                  aria-hidden
                  className="bg-brand-grad absolute inset-x-0 bottom-0 h-0.5 rounded-full"
                />
              )}
            </button>
          ))}
        </div>

        <CardContent className="flex flex-col gap-4 pt-5">
          {mode === "auto" ? (
            <SearchForm
              key={formSeed}
              initial={seedCriteria}
              onSubmit={searchAuto}
              loading={loading}
            />
          ) : (
            <ManualForm onSubmit={searchManual} loading={loading} />
          )}
          <SavedSearches current={lastCriteria} canSave={mode === "auto"} onApply={applySaved} />
        </CardContent>
      </Card>

      {error && <ErrorBanner message={error} />}
      <WarningBanner warnings={warnings} />

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-80" />
          ))}
        </div>
      )}

      {!loading && results.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px]" style={{ color: "var(--muted)" }}>
              {results.length} résultat{results.length > 1 ? "s" : ""}
            </p>
            <SortToggle value={sort} onChange={setSort} />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((company) => (
              <ResultCard
                key={keyOf(company)}
                company={company}
                state={addStates[keyOf(company)] ?? "idle"}
                onAdd={addProspect}
                onProspect={prospect}
              />
            ))}
          </div>
        </>
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
