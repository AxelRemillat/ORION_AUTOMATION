"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Star, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardContent, EmptyState, Skeleton, useToast } from "@/components/ui";
import { ApiError, postJson } from "@/lib/enrichment/api-client";
import { formatDate } from "@/lib/utils";
import type { Favorite } from "@/types";
import { MetaChip, SignalChip } from "./signal-chip";

/**
 * Stock de favoris : des entreprises déjà enrichies, gardées sous le coude.
 *
 * « Prospecter » rejoue l'instantané stocké — aucun appel Pappers, Linkup ou
 * Hunter n'est déclenché. C'est tout l'objet de cet écran : repayer un
 * enrichissement déjà effectué n'a aucun sens.
 */
export function FavoritesPanel({ refreshKey }: { refreshKey: number }) {
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/favorites", { cache: "no-store" });
      const payload = (await response.json()) as { favorites?: Favorite[]; error?: string };
      setFavorites(payload.favorites ?? []);
    } catch {
      setFavorites([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  /** Crée le prospect depuis l'instantané stocké, puis ouvre la Prospection. */
  async function prospect(favorite: Favorite) {
    setBusy(favorite.id);
    try {
      await postJson("/api/prospects", { company: favorite.company, source: "import" });
      toast.success(`${favorite.company_name} ajouté à vos prospects.`);
      router.push("/prospection");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        toast.success("Déjà dans vos prospects — ouverture de la Prospection.");
        router.push("/prospection");
        return;
      }
      toast.error(cause instanceof Error ? cause.message : "Ajout impossible.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(favorite: Favorite) {
    setBusy(favorite.id);
    try {
      await fetch(`/api/favorites/${favorite.id}`, { method: "DELETE" });
      setFavorites((current) => (current ?? []).filter((item) => item.id !== favorite.id));
      toast.success("Retiré des favoris.");
    } finally {
      setBusy(null);
    }
  }

  if (favorites === null) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!favorites.length) {
    return (
      <EmptyState
        icon={<Star aria-hidden />}
        title="Aucun favori"
        description="Mettez une entreprise en favori depuis les résultats : son enrichissement est conservé, vous pourrez la prospecter plus tard sans repayer d'appel API."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">
        {favorites.length} entreprise{favorites.length > 1 ? "s" : ""} en réserve. Prospecter depuis
        cette liste ne consomme <strong>aucun crédit</strong> : les données stockées sont réutilisées
        telles quelles.
      </p>

      {favorites.map((favorite) => {
        const snapshot = favorite.company as { signals?: { type?: string; label?: string }[] };
        const types = [...new Set((snapshot.signals ?? []).map((s) => s.type ?? "presse"))];
        return (
          <Card key={favorite.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-display text-[15px] font-semibold text-text">
                  {favorite.company_name}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {favorite.sector && <MetaChip>{favorite.sector}</MetaChip>}
                  {favorite.city && <MetaChip>{favorite.city}</MetaChip>}
                  {types.map((type) => (
                    <SignalChip key={type} type={type} />
                  ))}
                  {types.length === 0 && <Badge tone="neutral">aucun signal</Badge>}
                </div>
                <p className="mt-1.5 text-[11px] text-faint">
                  Enrichie et mise de côté le {formatDate(favorite.created_at)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => prospect(favorite)}
                  loading={busy === favorite.id}
                >
                  Prospecter
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(favorite)}
                  disabled={busy === favorite.id}
                  aria-label={`Retirer ${favorite.company_name} des favoris`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
