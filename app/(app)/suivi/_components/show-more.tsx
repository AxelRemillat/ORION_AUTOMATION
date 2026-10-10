"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * Pagination « Afficher plus », partagée par les colonnes, le tableau et les
 * relances dues.
 *
 * Une colonne de 117 cartes n'est pas une liste, c'est un mur : on en montre
 * les plus récentes et on déplie à la demande. Le TOTAL reste affiché ailleurs
 * (en-tête de colonne, badge du titre) — ce qui est paginé, c'est l'affichage,
 * jamais le compte.
 *
 * La recherche et les filtres s'appliquent AVANT d'arriver ici : une fiche
 * trouvée apparaît même si elle était au-delà des dix premières.
 */
export function useShowMore(total: number, step: number) {
  const [shown, setShown] = useState(step);
  const visible = Math.min(shown, total);
  return {
    visible,
    rest: Math.max(0, total - visible),
    more: () => setShown((current) => current + step),
  };
}

export function ShowMore({
  rest,
  onMore,
  label = "Afficher plus",
}: {
  rest: number;
  onMore: () => void;
  /** Libellé du bouton ; le reste à afficher est ajouté entre parenthèses. */
  label?: string;
}) {
  if (rest <= 0) return null;
  return (
    <Button variant="ghost" size="sm" onClick={onMore} className="w-full justify-center">
      {label}
      <span className="font-data text-faint">· {rest} de plus</span>
    </Button>
  );
}
