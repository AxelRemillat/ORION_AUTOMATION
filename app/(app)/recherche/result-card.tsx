"use client";

import { Check, ExternalLink, MapPin, Plus, Users } from "lucide-react";
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui";
import { formatEur } from "@/lib/utils";
import type { EnrichedCompany } from "@/lib/enrichment/types";
import { SignalList } from "./signal-list";

/** État d'ajout d'une carte, piloté par l'écran parent. */
export type AddState = "idle" | "loading" | "added" | "duplicate";

interface ResultCardProps {
  company: EnrichedCompany;
  state: AddState;
  onAdd: (company: EnrichedCompany) => void;
}

/** Ligne de chiffres clés, masquée quand la donnée n'a pas été récupérée. */
function KeyFigures({ company }: { company: EnrichedCompany }) {
  const { revenue_eur, revenue_year, headcount, leader, head_office_city } = company.key_figures;
  const items = [
    typeof revenue_eur === "number" && {
      label: `CA${typeof revenue_year === "number" ? ` ${revenue_year}` : ""}`,
      value: formatEur(revenue_eur),
    },
    typeof headcount === "number" && { label: "Effectif", value: `${headcount}` },
    typeof leader === "string" && { label: "Dirigeant", value: leader },
    typeof head_office_city === "string" && { label: "Siège", value: head_office_city },
  ].filter(Boolean) as { label: string; value: string }[];

  if (!items.length) return null;

  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-[13px]">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="text-muted">{item.label}</dt>
          <dd className="font-medium tabular-nums text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ResultCard({ company, state, onAdd }: ResultCardProps) {
  const done = state === "added" || state === "duplicate";

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{company.company_name}</CardTitle>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {company.sector && <Badge tone="accent">{company.sector}</Badge>}
          {company.size_range && (
            <Badge>
              <Users className="h-3 w-3" aria-hidden />
              {company.size_range}
            </Badge>
          )}
          {company.city && (
            <Badge>
              <MapPin className="h-3 w-3" aria-hidden />
              {company.city}
            </Badge>
          )}
          {/* Le filtre géographique porte sur les établissements : on le signale. */}
          {company.matched_branch && <Badge tone="info">Établissement local</Badge>}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <SignalList signals={company.signals} />
        <KeyFigures company={company} />
      </CardContent>

      <CardFooter className="justify-between">
        {company.website ? (
          <a
            href={company.website}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Site web
          </a>
        ) : (
          <span className="text-[13px] text-muted">
            {company.siren ? `SIREN ${company.siren}` : "Site inconnu"}
          </span>
        )}

        <Button
          size="sm"
          variant={done ? "secondary" : "primary"}
          loading={state === "loading"}
          disabled={done}
          onClick={() => onAdd(company)}
        >
          {done ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          {state === "duplicate" ? "Déjà suivi" : done ? "Ajouté" : "Ajouter à mes prospects"}
        </Button>
      </CardFooter>
    </Card>
  );
}
