"use client";

import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { NAF_SECTIONS, SIZE_BUCKETS } from "@/lib/enrichment/naf";
import { DEFAULT_ANALYSIS_LIMIT, MAX_ANALYSIS_LIMIT } from "@/lib/enrichment/limits";

export interface SearchCriteriaInput {
  q: string;
  section: string;
  size: string;
  zone: string;
  withSignals: boolean;
  /** Nombre d'entreprises réellement analysées — donc facturées. */
  limit: number;
}

const EMPTY: SearchCriteriaInput = {
  q: "",
  section: "",
  size: "petite",
  zone: "",
  withSignals: true,
  limit: DEFAULT_ANALYSIS_LIMIT,
};

/** Mode A — critères envoyés à l'annuaire public des entreprises. */
export function SearchForm({
  onSubmit,
  loading,
  initial,
}: {
  onSubmit: (criteria: SearchCriteriaInput) => void;
  loading: boolean;
  /**
   * Critères de départ. Le formulaire reste non contrôlé : pour appliquer une
   * recherche sauvegardée, l'écran parent le remonte via une `key`.
   */
  initial?: SearchCriteriaInput;
}) {
  // Une recherche sauvegardee avant l'arrivee du plafond n'a pas de `limit`.
  const [criteria, setCriteria] = useState<SearchCriteriaInput>(
    initial ? { ...EMPTY, ...initial } : EMPTY,
  );

  const update = <K extends keyof SearchCriteriaInput>(key: K, value: SearchCriteriaInput[K]) =>
    setCriteria((current) => ({ ...current, [key]: value }));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(criteria);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="secteur">Secteur</Label>
          <Select
            id="secteur"
            value={criteria.section}
            onChange={(event) => update("section", event.target.value)}
          >
            <option value="">Tous secteurs</option>
            {NAF_SECTIONS.map((section) => (
              <option key={section.code} value={section.code}>
                {section.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="taille">Effectif</Label>
          <Select id="taille" value={criteria.size} onChange={(event) => update("size", event.target.value)}>
            <option value="">Toutes tailles</option>
            {SIZE_BUCKETS.map((bucket) => (
              <option key={bucket.id} value={bucket.id}>
                {bucket.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="zone">Zone</Label>
          <Input
            id="zone"
            value={criteria.zone}
            onChange={(event) => update("zone", event.target.value)}
            placeholder="Ville, code postal ou dépt."
          />
        </div>

        <div>
          <Label htmlFor="motcle">Mot-clé (optionnel)</Label>
          <Input
            id="motcle"
            value={criteria.q}
            onChange={(event) => update("q", event.target.value)}
            placeholder="ex : logistique, e-commerce"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-44">
          <Label htmlFor="limite">Entreprises à analyser</Label>
          <Input
            id="limite"
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
        <p className="mb-2.5 max-w-sm text-[12px] leading-snug text-faint">
          Chaque analyse consomme un crédit Pappers et une recherche Linkup. Au-delà de ce
          nombre, rien n&apos;est enrichi — et rien n&apos;est facturé.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
          <input
            type="checkbox"
            checked={criteria.withSignals}
            onChange={(event) => update("withSignals", event.target.checked)}
            className="h-4 w-4 rounded border-border bg-surface-2 accent-accent"
          />
          Chercher les signaux web (plus lent, consomme du quota Linkup)
        </label>

        <Button type="submit" loading={loading}>
          <Search className="h-4 w-4" aria-hidden />
          Rechercher
        </Button>
      </div>
    </form>
  );
}
