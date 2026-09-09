import { Sparkles, TrendingUp } from "lucide-react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import type { Insight } from "../_lib/insights";

const TONE_TOKEN: Record<Insight["tone"], string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  neutral: "var(--primary)",
};

/** Constats tirés des données réelles, avec seuil d'effectif minimum. */
export function WhatWorks({ insights }: { insights: Insight[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
        <CardTitle>Ce qui marche</CardTitle>
      </CardHeader>
      <CardContent>
        {insights.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-muted">
            Pas encore assez de volume pour tirer des conclusions. Il faut au moins trois prospects
            contactés par segment avant qu&apos;un pourcentage veuille dire quelque chose.
          </p>
        ) : (
          <ul className="space-y-3">
            {insights.map((insight) => (
              <li key={insight.key} className="flex items-start gap-2.5">
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: TONE_TOKEN[insight.tone] }}
                  aria-hidden
                />
                <p className="text-[13px] leading-relaxed text-text">{insight.text}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Emplacement réservé aux synthèses IA. Aucun contenu n'est inventé ici :
 * la carte annonce ce qui arrivera, elle ne simule pas un résultat.
 */
export function AiInsightsSlot() {
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-halo" aria-hidden />
      <CardHeader className="relative">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          <CardTitle>Insights IA</CardTitle>
          <Badge tone="neutral" className="ml-1">
            À venir
          </Badge>
        </div>
        <CardDescription>
          Emplacement prévu pour une lecture rédigée de ces chiffres : segments à privilégier,
          objet d&apos;email qui accroche, moment de relance optimal.
        </CardDescription>
      </CardHeader>
      <CardContent className="relative">
        <div
          className="rounded-lg border border-dashed p-4 text-[13px] leading-relaxed text-faint"
          style={{ borderColor: "var(--line)" }}
        >
          Rien n&apos;est généré pour l&apos;instant : brancher ce bloc suppose un appel serveur
          dédié qui reprend les agrégats ci-dessus. Tant qu&apos;il n&apos;existe pas, aucun texte
          n&apos;est affiché ici pour ne pas faire passer une supposition pour une analyse.
        </div>
      </CardContent>
    </Card>
  );
}
