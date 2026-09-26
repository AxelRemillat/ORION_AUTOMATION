"use client";

import { Sprout } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";

/**
 * Fiche sans accroche forte.
 *
 * Ce n'est pas une panne : c'est un manque de matière. Générer quand même
 * produit un mail dont la première phrase resterait vraie pour n'importe quel
 * concurrent — on l'autorise, parce qu'un brouillon reste une base éditable,
 * mais on le dit, et le brouillon en portera la mention.
 */
export function FeedingBanner({
  message,
  loading,
  onForce,
}: {
  message: string;
  loading: boolean;
  onForce: () => void;
}) {
  return (
    <Card className="border-warn/30 bg-warn/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <span className="flex items-start gap-2.5 text-[13px] text-text">
          <Sprout className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          <span>
            {message}
            <span className="mt-0.5 block text-[12px] text-muted">
              Relancez une recherche de signaux, ou renseignez son site, pour une accroche qui
              lui soit propre.
            </span>
          </span>
        </span>
        <Button size="sm" variant="outline" loading={loading} onClick={onForce}>
          Générer quand même
        </Button>
      </CardContent>
    </Card>
  );
}
