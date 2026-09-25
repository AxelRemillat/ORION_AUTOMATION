"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, SearchX } from "lucide-react";
import { Card, CardContent, EmptyState, Skeleton, useToast } from "@/components/ui";
import { ApiError, postJson } from "@/lib/enrichment/api-client";
import { compareHeat, heatContextOf, heatScore } from "@/lib/scoring";
import type { EnrichedCompany, EnrichmentWarning } from "@/lib/enrichment/types";
import { ErrorBanner, WarningBanner } from "./banners";
import { ManualForm } from "./manual-form";
import { FavoritesPanel } from "./favorites-panel";
import { ResultCard, type AddState, type FavoriteState } from "./result-card";
import { SavedSearches } from "./saved-searches";
import { SearchForm, type SearchCriteriaInput } from "./search-form";
import { DEFAULT_ANALYSIS_LIMIT } from "@/lib/enrichment/limits";
import { ScanProgress } from "./scan-progress";
import { ScanSummary, type ScanStats } from "./scan-summary";
import { useSearchRun } from "./use-search-run";
import { SignalFilters } from "./signal-filters";

type Mode = "auto" | "manuel" | "favoris";

const TAB_LABELS: Record<Mode, string> = {
  auto: "Recherche par critères",
  manuel: "Ajout manuel",
  favoris: "Favoris",
};

interface SearchResponse {
  results: EnrichedCompany[];
  /** Entreprises trouvees par l'annuaire, bien au-dela de ce qu'on scanne. */
  total: number;
  /** Candidats passes au scan Linkup (phase 1). */
  scanned: number;
  /** Parmi eux, ceux portant un signal atteste. */
  withSignal: number;
  /** Fiches Pappers reellement ouvertes (phase 2). */
  analysed: number;
  /** Appels Linkup perdus, comptes a part. */
  unverified?: number;
  /** `true` quand le total de l'annuaire est plafonne. */
  totalCapped?: boolean;
  /** Zone reellement appliquee, telle que resolue. */
  zoneLabel?: string | null;
  /** Entreprises ecartees car deja vues. */
  skippedKnown?: number;
  /** Pages d'annuaire lues. */
  pagesRead?: number;
  /** Pourquoi la boucle s'est arretee. */
  stopReason?: string;
  /** Entreprises ecartees apres enrichissement : effectif hors tranche. */
  outOfBracket?: string[];
  warnings: EnrichmentWarning[];
}

/** Identifie une carte de façon stable entre deux rendus. */
const keyOf = (company: EnrichedCompany) => company.siren ?? company.company_name;

export function RechercheClient() {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("auto");
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);
  /** Identifiant du scan suivi : tant qu'il vit, la barre s'affiche. */
  const [runId, setRunId] = useState<string | null>(null);
  /** Vrai une fois le dernier scan relu : evite d'ecraser sa reprise. */
  const restored = useRef(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<EnrichedCompany[]>([]);
  const [warnings, setWarnings] = useState<EnrichmentWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addStates, setAddStates] = useState<Record<string, AddState>>({});
  // Id de la fiche deja en portefeuille, pour pouvoir y renvoyer depuis la carte.
  const [duplicateIds, setDuplicateIds] = useState<Record<string, string>>({});
  const [signalFilter, setSignalFilter] = useState<string[]>([]);
  const [favoriteStates, setFavoriteStates] = useState<Record<string, FavoriteState>>({});
  // Incremente a chaque mise en favori : reveille le panneau des favoris.
  const [favoritesKey, setFavoritesKey] = useState(0);
  const [scan, setScan] = useState<ScanStats | null>(null);
  const [lastCriteria, setLastCriteria] = useState<SearchCriteriaInput | null>(null);
  // Remonter le formulaire est le moyen le plus simple d'y injecter des critères.
  const [formSeed, setFormSeed] = useState(0);
  const [seedCriteria, setSeedCriteria] = useState<SearchCriteriaInput | undefined>();

  /**
   * Ordre unique : du plus chaud au plus froid. Le tri par « pertinence »
   * (l'ordre brut de l'annuaire) a ete retire : il n'apportait rien qu'un
   * classement par intention ne donne deja.
   */
  const sorted = useMemo(
    () =>
      [...results].sort((a, b) =>
        compareHeat(
          heatScore(a.signals, { seed: keyOf(a), context: heatContextOf(a.key_figures) }),
          heatScore(b.signals, { seed: keyOf(b), context: heatContextOf(b.key_figures) }),
        ),
      ),
    [results],
  );

  /** Types de signaux presents dans les resultats, avec leur effectif. */
  const signalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const company of results) {
      for (const type of new Set(company.signals.map((signal) => signal.type ?? "presse"))) {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [results]);

  /** Un resultat passe le filtre s'il porte AU MOINS un des types coches. */
  const visible = useMemo(() => {
    if (!signalFilter.length) return sorted;
    return sorted.filter((company) =>
      company.signals.some((signal) => signalFilter.includes(signal.type ?? "presse")),
    );
  }, [sorted, signalFilter]);

  // Sondage du dernier scan : rapide sur cet ecran, c'est lui qui alimente la
  // barre et qui restitue les resultats au retour sur la page.
  const { run, loaded } = useSearchRun(1_000);
  const running = run?.status === "running";

  useEffect(() => {
    // Une seule reprise, au premier chargement : ensuite c'est la recherche en
    // cours qui fait autorite, pas la ligne en base.
    if (!loaded || restored.current) return;
    restored.current = true;
    if (!run) return;

    setRunId(run.status === "running" ? run.id : null);
    if (run.results.length) {
      setResults(run.results as EnrichedCompany[]);
      setWarnings(run.warnings as EnrichmentWarning[]);
      setSearched(true);
    }
  }, [loaded, run]);

  /** Enveloppe commune aux deux modes : reset, appel, gestion d'erreur. */
  async function runSearch(
    request: () => Promise<{
      results: EnrichedCompany[];
      warnings: EnrichmentWarning[];
      scan?: ScanStats;
    }>,
  ) {
    setLoading(true);
    setError(null);
    try {
      const data = await request();
      setResults(data.results);
      setWarnings(data.warnings);
      setAddStates({});
      setFavoriteStates({});
      setSignalFilter([]);
      setScan(data.scan ?? null);
    } catch (cause) {
      setResults([]);
      setWarnings([]);
      setScan(null);
      setError(cause instanceof Error ? cause.message : "Recherche impossible.");
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }

  const searchAuto = (criteria: SearchCriteriaInput) => {
    setLastCriteria(criteria);
    return runSearch(async () => {
      // Le job est ouvert AVANT le travail : l'ecran a son identifiant tout de
      // suite, donc la barre apparait des la premiere seconde.
      const opened = await postJson<{ id: string }>("/api/search/runs", criteria);
      setRunId(opened.id);
      const data = await postJson<SearchResponse>("/api/prospects/search", {
        ...criteria,
        runId: opened.id,
      });
      setRunId(null);
      return {
        results: data.results,
        warnings: data.warnings,
        scan: {
          total: data.total,
          scanned: data.scanned ?? 0,
          unverified: data.unverified ?? 0,
          withSignal: data.withSignal ?? data.results.length,
          analysed: data.analysed ?? data.results.length,
          // Une recherche sauvegardee avant la refonte n'a pas de plafond.
          requested: criteria.limit ?? DEFAULT_ANALYSIS_LIMIT,
          totalCapped: data.totalCapped ?? false,
          zoneLabel: data.zoneLabel ?? null,
          skippedKnown: data.skippedKnown ?? 0,
          pagesRead: data.pagesRead ?? 0,
          stopReason: data.stopReason,
          outOfBracket: data.outOfBracket ?? [],
        },
      };
    });
  };

  const searchManual = (query: string) => {
    setLastCriteria(null);
    return runSearch(async () => {
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

      // Un doublon n'est PAS une erreur : l'entreprise est deja suivie, on le
      // dit comme une information et on garde le lien vers sa fiche.
      if (duplicate) {
        const prospectId =
          cause instanceof ApiError && typeof cause.payload?.prospectId === "string"
            ? cause.payload.prospectId
            : null;
        if (prospectId) setDuplicateIds((current) => ({ ...current, [key]: prospectId }));
        toast.toast(`${company.company_name} est déjà dans ton portefeuille.`);
        return "duplicate";
      }

      toast.error(cause instanceof Error ? cause.message : "Ajout impossible.");
      return "idle";
    }
  }

  /**
   * Met en reserve l'entreprise DEJA enrichie. Aucun appel Pappers, Linkup ou
   * Hunter : on stocke l'instantane que la recherche vient de payer.
   */
  async function favorite(company: EnrichedCompany) {
    const key = keyOf(company);
    if (favoriteStates[key] === "saved" || favoriteStates[key] === "loading") return;

    setFavoriteStates((current) => ({ ...current, [key]: "loading" }));
    try {
      await postJson("/api/favorites", { company });
      setFavoriteStates((current) => ({ ...current, [key]: "saved" }));
      setFavoritesKey((current) => current + 1);
      toast.success(`${company.company_name} gardé en réserve, sans nouvel appel API.`);
    } catch (cause) {
      // Un doublon n'est pas un echec : l'entreprise est deja en reserve.
      const duplicate = cause instanceof ApiError && cause.status === 409;
      setFavoriteStates((current) => ({ ...current, [key]: duplicate ? "saved" : "idle" }));
      if (duplicate) toast.success("Déjà dans vos favoris.");
      else toast.error(cause instanceof Error ? cause.message : "Mise en favori impossible.");
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
          {(["auto", "manuel", "favoris"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className="relative rounded-t px-3 py-2 text-[13px] font-medium motion-safe:transition-colors"
              style={{ color: mode === value ? "var(--text)" : "var(--muted)" }}
            >
              {TAB_LABELS[value]}
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
          {mode === "auto" && (
            <SearchForm
              key={formSeed}
              initial={seedCriteria}
              onSubmit={searchAuto}
              loading={loading}
            />
          )}
          {mode === "manuel" && <ManualForm onSubmit={searchManual} loading={loading} />}
          {mode === "favoris" && <FavoritesPanel refreshKey={favoritesKey} />}
          {mode !== "favoris" && (
            <SavedSearches current={lastCriteria} canSave={mode === "auto"} onApply={applySaved} />
          )}
        </CardContent>
      </Card>

      {runId && running && run && (
        <ScanProgress
          run={run}
          stopping={stopping}
          onStop={async () => {
            setStopping(true);
            try {
              await postJson(`/api/search/runs/${runId}/stop`, {});
              toast.toast("Arrêt demandé : le lot en cours se termine.");
            } catch {
              toast.error("Impossible de demander l'arrêt.");
            } finally {
              setStopping(false);
            }
          }}
        />
      )}

      {error && <ErrorBanner message={error} />}
      <WarningBanner warnings={warnings} />

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-80" />
          ))}
        </div>
      )}

      {!loading && mode !== "favoris" && scan && <ScanSummary scan={scan} />}

      {!loading && mode !== "favoris" && results.length > 0 && (
        <>
          <div className="flex flex-col gap-3">
            <p className="text-[13px]" style={{ color: "var(--muted)" }}>
              {visible.length} résultat{visible.length > 1 ? "s" : ""}
              {signalFilter.length > 0 && ` sur ${results.length} analysé${results.length > 1 ? "s" : ""}`}
              {" · "}
              <span style={{ color: "var(--faint)" }}>du plus chaud au plus froid</span>
            </p>

            <SignalFilters
              counts={signalCounts}
              selected={signalFilter}
              onToggle={(type) =>
                setSignalFilter((current) =>
                  current.includes(type)
                    ? current.filter((item) => item !== type)
                    : [...current, type],
                )
              }
              onClear={() => setSignalFilter([])}
            />
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title="Aucun résultat pour ces signaux"
              description="Décochez un filtre pour élargir."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((company) => (
                <ResultCard
                  key={keyOf(company)}
                  company={company}
                  state={addStates[keyOf(company)] ?? "idle"}
                  onAdd={addProspect}
                  onProspect={prospect}
                  onFavorite={favorite}
                  favoriteState={favoriteStates[keyOf(company)] ?? "idle"}
                  duplicateId={duplicateIds[keyOf(company)] ?? null}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/*
        Aucun resultat : on n'affiche un etat vide que si le scan n'a rien eu a
        se mettre sous la dent. Quand le scan a tourne, c'est <ScanSummary> qui
        explique pourquoi — et surtout qu'aucune fiche n'a ete facturee.
      */}
      {!loading && mode !== "favoris" && searched && !results.length && !error && !scan?.scanned && (
        <EmptyState
          icon={<SearchX />}
          title="Aucune entreprise trouvée"
          description="Élargissez la zone géographique ou retirez un critère."
        />
      )}

      {!loading && mode !== "favoris" && !searched && (
        <EmptyState
          icon={<Building2 />}
          title="Lancez une recherche"
          description="Croisez un secteur, une taille et une zone, ou collez directement un nom, un SIREN ou une URL."
        />
      )}
    </div>
  );
}
