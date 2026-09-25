"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar } from "lucide-react";
import { readProgress, useSearchRun } from "@/app/(app)/recherche/use-search-run";

/**
 * Bandeau « Scan en cours », visible depuis n'importe quelle page.
 *
 * Il ne s'affiche PAS sur /recherche : la carte de progression y est déjà, et
 * deux indicateurs pour la même chose se contrediraient au premier décalage de
 * sondage. Cadence volontairement lente — cinq secondes suffisent pour un
 * bandeau, et il est monté sur toutes les pages.
 */
export function ScanBanner() {
  const pathname = usePathname();
  const onSearchPage = pathname.startsWith("/recherche");
  const { run } = useSearchRun(5_000, !onSearchPage);

  if (onSearchPage || run?.status !== "running") return null;
  const progress = readProgress(run);

  return (
    <Link
      href="/recherche"
      className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[12px] font-medium text-primary-ink motion-safe:transition-colors hover:bg-primary/15"
    >
      <Radar className="h-3.5 w-3.5 animate-pulse" aria-hidden />
      Scan en cours
      <span className="font-data tabular-nums">
        {progress.scanned} vérifiées · {progress.withSignal} signaux
      </span>
    </Link>
  );
}
