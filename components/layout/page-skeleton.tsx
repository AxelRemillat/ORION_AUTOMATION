import { Skeleton } from "@/components/ui";

/**
 * SQUELETTES DE CHARGEMENT (Cowork #23) : affichés tout de suite au clic sur un onglet
 * (loading.tsx), le temps que le serveur prépare la page. Leur forme suit celle de la
 * page pour que rien ne « saute » à l'arrivée des données. Purement décoratifs.
 */
export type SkeletonLayout = "aujourdhui" | "cockpit" | "liste" | "tableau" | "formulaire";

function Header() {
  return (
    <div className="mb-6 space-y-2">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-full max-w-md" />
    </div>
  );
}

const rows = (count: number, className = "h-14") => Array.from({ length: count }, (_, index) => <Skeleton key={index} className={className} />);

export function PageSkeleton({ layout }: { layout: SkeletonLayout }) {
  return (
    <div role="status" aria-live="polite" aria-label="Chargement de la page">
      <span className="sr-only">Chargement…</span>
      <Header />
      {layout === "aujourdhui" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-2">{rows(7)}</div>
          <Skeleton className="hidden h-[28rem] lg:block" />
        </div>
      )}
      {layout === "cockpit" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{rows(4, "h-24")}</div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{rows(2, "h-64")}</div>
        </div>
      )}
      {layout === "liste" && (
        <div className="space-y-4">
          <div className="flex gap-2">{rows(3, "h-9 w-24")}</div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="space-y-2">{rows(6)}</div>
            <Skeleton className="hidden h-96 lg:block" />
          </div>
        </div>
      )}
      {layout === "tableau" && <div className="space-y-2">{rows(10, "h-11")}</div>}
      {layout === "formulaire" && <div className="max-w-2xl space-y-3">{rows(5, "h-12")}</div>}
    </div>
  );
}
