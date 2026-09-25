"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Radar } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { SIZE_BUCKETS } from "@/lib/enrichment/naf";
import { DEFAULT_ANALYSIS_LIMIT, MAX_ANALYSIS_LIMIT } from "@/lib/enrichment/limits";
import { DEFAULT_SIGNAL_DAYS, SIGNAL_WINDOWS, type SignalSourceState } from "@/lib/signals/shared";

export interface SignalCriteriaInput {
  /** Numéro de département : seul filtre géographique des deux sources. */
  departement: string;
  size: string;
  /** Fenêtre d'antériorité, en jours. */
  days: number;
  limit: number;
}

const EMPTY: SignalCriteriaInput = {
  departement: "",
  size: "petite",
  days: DEFAULT_SIGNAL_DAYS,
  limit: DEFAULT_ANALYSIS_LIMIT,
};

/**
 * Mode « Signaux d'abord » — l'entonnoir pris par l'autre bout.
 *
 * Le département est obligatoire et il n'y a pas de champ « zone » libre : les
 * deux sources officielles ne filtrent que par département. Proposer une ville
 * aurait laissé croire à une précision que l'API ne rend pas.
 */
export function SignalsForm({
  onSubmit,
  loading,
}: {
  onSubmit: (criteria: SignalCriteriaInput) => void;
  loading: boolean;
}) {
  const [criteria, setCriteria] = useState<SignalCriteriaInput>(EMPTY);
  const [sources, setSources] = useState<SignalSourceState[] | null>(null);

  // L'état des sources se lit AVANT toute recherche : une source à configurer
  // doit être grisée d'entrée, pas découverte après une recherche qui échoue.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/prospects/signals", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { sources: SignalSourceState[] };
        if (!cancelled) setSources(body.sources);
      } catch {
        // Sources inconnues : on n'affiche rien plutôt qu'un état faux.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof SignalCriteriaInput>(key: K, value: SignalCriteriaInput[K]) =>
    setCriteria((current) => ({ ...current, [key]: value }));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(criteria);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="departement">Département</Label>
          <Input
            id="departement"
            value={criteria.departement}
            onChange={(event) => update("departement", event.target.value)}
            placeholder="ex : 69"
            inputMode="numeric"
            maxLength={3}
            required
          />
        </div>

        <div>
          <Label htmlFor="taille-signaux">Effectif</Label>
          <Select
            id="taille-signaux"
            value={criteria.size}
            onChange={(event) => update("size", event.target.value)}
          >
            {SIZE_BUCKETS.map((bucket) => (
              <option key={bucket.id} value={bucket.id}>
                {bucket.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="fenetre">Signaux de moins de</Label>
          <Select
            id="fenetre"
            value={String(criteria.days)}
            onChange={(event) => update("days", Number(event.target.value))}
          >
            {SIGNAL_WINDOWS.map((days) => (
              <option key={days} value={days}>
                {days} jours
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="limite-signaux">Fiches à ouvrir</Label>
          <Input
            id="limite-signaux"
            type="number"
            min={1}
            max={MAX_ANALYSIS_LIMIT}
            step={1}
            value={criteria.limit}
            onChange={(event) =>
              update(
                "limit",
                Math.max(1, Math.min(MAX_ANALYSIS_LIMIT, Number(event.target.value) || 1)),
              )
            }
          />
        </div>
      </div>

      {sources && (
        <ul className="flex flex-wrap gap-2" aria-label="Sources de signaux">
          {sources.map((source) => (
            <li
              key={source.id}
              className={
                source.available
                  ? "inline-flex items-center gap-1.5 rounded-full border border-good/25 bg-good/10 px-2.5 py-1 text-[12px] text-good-ink"
                  : "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-faint"
              }
            >
              <span className="font-medium">{source.label}</span>
              {source.available ? "active" : `· ${source.unavailableReason}`}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[46rem] text-[13px] leading-snug text-muted">
          Ici on part de l&apos;<strong className="font-medium text-text">événement</strong>, pas de
          l&apos;annuaire : une annonce publiée par un greffe est datée et vraie par construction, il
          n&apos;y a rien à vérifier sur le web. Aucune fiche n&apos;est ouverte pour une entreprise
          qui n&apos;a pas bougé — <strong className="font-medium text-text">zéro appel Linkup</strong>.
        </p>

        <Button type="submit" loading={loading}>
          <Radar className="h-4 w-4" aria-hidden />
          Chercher les signaux
        </Button>
      </div>
    </form>
  );
}
