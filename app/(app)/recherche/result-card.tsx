"use client";

import { ArrowRight, Check, ExternalLink, MapPin, Plus, Star, Users } from "lucide-react";
import { Button, Card, CardContent, CardFooter, CardHeader } from "@/components/ui";
import { formatEur } from "@/lib/utils";
import { heatContextOf, heatScore, whyNow } from "@/lib/scoring";
import type { EnrichedCompany } from "@/lib/enrichment/types";
import { HeatGauge } from "./heat-gauge";
import { ExampleTag, MetaChip, SignalChip } from "./signal-chip";
import { WhyNowCard } from "./why-now";
import Link from "next/link";

/** État d'ajout d'une carte, piloté par l'écran parent. */
export type AddState = "idle" | "loading" | "added" | "duplicate";

/** État de mise en favori d'une carte. */
export type FavoriteState = "idle" | "loading" | "saved";

interface ResultCardProps {
  company: EnrichedCompany;
  state: AddState;
  onAdd: (company: EnrichedCompany) => void;
  /** Ajoute si nécessaire puis ouvre la Prospection. */
  onProspect: (company: EnrichedCompany) => void;
  /** Met l'entreprise DÉJÀ enrichie en réserve, sans nouvel appel API. */
  onFavorite: (company: EnrichedCompany) => void;
  favoriteState: FavoriteState;
  /** Fiche existante quand l'entreprise est deja en portefeuille (409). */
  duplicateId?: string | null;
}

/**
 * Dirigeant affiché : une PERSONNE, toujours que ce soit possible.
 *
 * L'annuaire liste les représentants dans un ordre qui n'a rien de
 * hiérarchique : pour BLUE ENERFREEZE il rend « SOCIETE IMMOSTEF » parmi les
 * dirigeants, et c'est ce nom de holding qui s'affichait — inutilisable pour
 * écrire à quelqu'un. On préfère donc, dans l'ordre : la personne physique
 * retrouvée (le cas échéant derrière la holding, avec la mention « via »),
 * puis à défaut la personne morale, explicitement étiquetée « holding ».
 */
function leaderLine(figures: EnrichedCompany["key_figures"]): string | null {
  const person = typeof figures.leader_person === "string" ? figures.leader_person : null;
  const via = typeof figures.leader_via === "string" ? figures.leader_via : null;
  const role = typeof figures.leader_role === "string" ? figures.leader_role : null;
  if (person) {
    const suffix = [role, via ? `via ${via}` : null].filter(Boolean).join(", ");
    return suffix ? `${person} (${suffix})` : person;
  }

  const legal = typeof figures.leader === "string" ? figures.leader : null;
  return legal ? `${legal} — holding` : null;
}

/** Ligne de chiffres clés, masquée quand la donnée n'a pas été récupérée. */
function KeyFigures({ company }: { company: EnrichedCompany }) {
  const { revenue_eur, revenue_year, headcount, head_office_city } = company.key_figures;
  const leader = leaderLine(company.key_figures);
  const items = [
    typeof revenue_eur === "number" && {
      label: `CA${typeof revenue_year === "number" ? ` ${revenue_year}` : ""}`,
      value: formatEur(revenue_eur),
    },
    typeof headcount === "number" && { label: "Effectif", value: `${headcount}` },
    leader && { label: "Dirigeant", value: leader },
    typeof head_office_city === "string" && { label: "Siège", value: head_office_city },
  ].filter(Boolean) as { label: string; value: string }[];

  if (!items.length) return null;

  return (
    <dl
      className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-[13px]"
      style={{ borderColor: "var(--line-soft)" }}
    >
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt style={{ color: "var(--muted)" }}>{item.label}</dt>
          <dd className="font-data font-medium" style={{ color: "var(--text)" }}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ResultCard({
  company,
  state,
  onAdd,
  onProspect,
  onFavorite,
  favoriteState,
  duplicateId,
}: ResultCardProps) {
  const done = state === "added" || state === "duplicate";
  const score = heatScore(company.signals, {
    seed: company.siren ?? company.company_name,
    context: heatContextOf(company.key_figures),
  });
  const why = whyNow(company.signals);
  const figures = company.key_figures;
  const parentGroup =
    (typeof figures.parent_group === "string" && figures.parent_group) ||
    (typeof figures.parent_company === "string" && figures.parent_company) ||
    null;

  // Types de signaux distincts, pour ne pas répéter la même puce.
  const chipTypes = [...new Set((company.signals ?? []).map((signal) => signal.type ?? "presse"))];

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--text)" }}>
            {company.company_name}
          </h3>
          {!score.real && <ExampleTag label="score exemple" />}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {company.sector && <MetaChip>{company.sector}</MetaChip>}
          {company.size_range && (
            <MetaChip>
              <Users className="h-3 w-3" aria-hidden />
              {company.size_range}
            </MetaChip>
          )}
          {company.city && (
            <MetaChip>
              <MapPin className="h-3 w-3" aria-hidden />
              {company.city}
            </MetaChip>
          )}
          {/* Le filtre géographique porte sur les établissements : on le signale. */}
          {company.matched_branch && <MetaChip>Établissement local</MetaChip>}
          {/* Appartenance a un groupe : elle change a qui on ecrit, et le score. */}
          {parentGroup && <MetaChip>Filiale de {parentGroup}</MetaChip>}
        </div>

        <div className="mt-3">
          <HeatGauge score={score} />
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {chipTypes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chipTypes.map((type) => (
              <SignalChip
                key={type}
                type={type}
                title={company.signals.find((s) => (s.type ?? "presse") === type)?.label}
              />
            ))}
          </div>
        )}

        <WhyNowCard why={why} />
        <KeyFigures company={company} />
      </CardContent>

      <CardFooter className="flex-wrap justify-between gap-2">
        {company.website ? (
          <a
            href={company.website}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[13px] underline-offset-2 hover:underline"
            style={{ color: "var(--muted)" }}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Site web
          </a>
        ) : (
          <span className="text-[13px]" style={{ color: "var(--muted)" }}>
            {company.siren ? `SIREN ${company.siren}` : "Site inconnu"}
          </span>
        )}

        <div className="flex items-center gap-2">
          {/* L'enrichissement de cette carte est deja paye : le mettre en
              reserve evite de le refaire dans quelques semaines. */}
          <Button
            size="sm"
            variant="ghost"
            loading={favoriteState === "loading"}
            disabled={favoriteState === "saved"}
            onClick={() => onFavorite(company)}
            title={
              favoriteState === "saved"
                ? "Déjà en favori"
                : "Garder en réserve sans redépenser de crédit"
            }
            aria-label={`Mettre ${company.company_name} en favori`}
          >
            <Star
              className={`h-4 w-4 ${favoriteState === "saved" ? "fill-current" : ""}`}
              aria-hidden
            />
            {favoriteState === "saved" ? "En favori" : "Favori"}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            loading={state === "loading"}
            disabled={done}
            onClick={() => onAdd(company)}
          >
            {done ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            {state === "duplicate" ? "Déjà dans ton portefeuille" : done ? "Ajouté" : "Ajouter"}
          </Button>

          {/* Un doublon n'est pas une impasse : on conduit a la fiche existante. */}
          {state === "duplicate" && duplicateId && (
            <Link
              href={`/suivi/${duplicateId}`}
              className="text-[13px] underline decoration-dotted underline-offset-2"
              style={{ color: "var(--primary-ink)" }}
            >
              Voir la fiche
            </Link>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => onProspect(company)}
            loading={state === "loading"}
          >
            Prospecter
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
