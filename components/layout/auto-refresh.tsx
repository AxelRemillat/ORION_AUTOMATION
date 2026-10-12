"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AUTO_REFRESH_MS, freshnessLabel, shouldRefresh } from "@/lib/auto-refresh";

/** État courant du document : onglet visible, saisie en cours. */
function context() {
  const active = document.activeElement as HTMLElement | null;
  return {
    visible: document.visibilityState === "visible",
    activeTag: active?.tagName ?? null,
    activeEditable: Boolean(active?.isContentEditable),
    activeType: active instanceof HTMLInputElement ? active.type : null,
    editing: Boolean(document.querySelector("[data-editing='true']")),
  };
}

/**
 * Relit les données de la page toutes les 60 s (Cowork #23) quand l'onglet est visible
 * et qu'Axel ne saisit rien ; au retour sur l'onglet, tout de suite si c'est dû.
 * Indicateur discret « à jour il y a X s », en bas à gauche.
 */
export function AutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const last = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    last.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    const tryRefresh = () => {
      setNow(Date.now());
      if (Date.now() - last.current < AUTO_REFRESH_MS || !shouldRefresh(context())) return;
      last.current = Date.now();
      setRefreshing(true);
      router.refresh();
      window.setTimeout(() => setRefreshing(false), 1200);
    };
    const timer = window.setInterval(tryRefresh, 5_000);
    document.addEventListener("visibilitychange", tryRefresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tryRefresh);
    };
  }, [router]);

  // Aujourd'hui garde sa barre d'action en bas : l'indicateur passe au-dessus, sans rien déplacer.
  const docked = pathname?.startsWith("/aujourdhui");
  return (
    <div
      aria-live="off"
      className={cn("pointer-events-none fixed left-2 z-20 flex items-center gap-1 rounded-full bg-surface/80 px-2 py-0.5 font-data text-[10px] text-faint shadow-mist backdrop-blur", docked ? "bottom-24" : "bottom-2")}
    >
      <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} aria-hidden />
      {freshnessLabel(last.current, now)}
    </div>
  );
}
