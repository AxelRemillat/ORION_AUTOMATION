"use client";

import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { NAF_SECTIONS, SIZE_BUCKETS } from "@/lib/enrichment/naf";
import {
  DEFAULT_ANALYSIS_LIMIT,
  DEFAULT_SCAN_WIDTH,
  MAX_ANALYSIS_LIMIT,
  MAX_SCAN_WIDTH,
  MIN_SCAN_WIDTH,
} from "@/lib/enrichment/limits";

export interface SearchCriteriaInput {
  q: string;
  section: string;
  size: string;
  zone: string;
  /** Conserve pour les recherches sauvegardees avant la refonte en deux phases. */
  withSignals: boolean;
  /** Phase 2 : entreprises enrichies en profondeur (Pappers). */
  limit: number;
  /** Phase 1 : candidats passes au scan Linkup. */
  scanWidth: number;
  /**
   * Autorise le scan a depasser le nombre demande pour atteindre l'objectif
   * de fiches (jusqu'au plafond de 3x). Decoche = on s'arrete au nombre
   * demande, quitte a rendre moins de fiches.
   */
  goFurther?: boolean;
  /** Passe outre le ciblage, le temps d'une recherche. */
  includeExcluded?: boolean;
}

const EMPTY: SearchCriteriaInput = {
  q: "",
  section: "",
  size: "petite",
  zone: "",
  withSignals: true,
  limit: DEFAULT_ANALYSIS_LIMIT,
  scanWidth: DEFAULT_SCAN_WIDTH,
  goFurther: true,
  includeExcluded: false,
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

      <div className="grid gap-4 sm:grid-cols-[11rem_11rem_1fr] sm:items-end">
        <div>
          <Label htmlFor="scan">Entreprises à scanner</Label>
          <Input
            id="scan"
            type="number"
            min={MIN_SCAN_WIDTH}
            max={MAX_SCAN_WIDTH}
            step={1}
            value={criteria.scanWidth}
            onChange={(event) =>
              update(
                "scanWidth",
                Math.max(
                  MIN_SCAN_WIDTH,
                  Math.min(MAX_SCAN_WIDTH, Number(event.target.value) || MIN_SCAN_WIDTH),
                ),
              )
            }
          />
          <p className="mt-1 text-[12px] leading-snug text-faint">
            ORION peut aller jusqu&apos;à 3× ce nombre pour atteindre tes fiches (plafond).
          </p>
          <label className="mt-1.5 flex items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={criteria.goFurther !== false}
              onChange={(event) => update("goFurther", event.target.checked)}
            />
            Aller plus loin si besoin
          </label>
          <label className="mt-1.5 flex items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={criteria.includeExcluded === true}
              onChange={(event) => update("includeExcluded", event.target.checked)}
            />
            Inclure les exclus
          </label>
        </div>

        <div>
          <Label htmlFor="limite">Fiches à ouvrir</Label>
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

        <p className="mb-2.5 text-[12px] leading-snug text-muted">
          <strong className="font-medium text-text">Scan</strong> : une recherche Linkup par
          entreprise pour repérer qui bouge — large et bon marché.{" "}
          <strong className="font-medium text-text">Fiches</strong> : Pappers (puis Hunter à la
          rédaction), réservé aux entreprises qui ressortent du scan. Une entreprise sans signal
          n&apos;est jamais ouverte.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          Les résultats sont classés du plus chaud au plus froid.
        </p>

        <Button type="submit" loading={loading}>
          <Search className="h-4 w-4" aria-hidden />
          Rechercher
        </Button>
      </div>
    </form>
  );
}
