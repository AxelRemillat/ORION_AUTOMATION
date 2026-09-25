import { Radar, SearchX, TrendingUp } from "lucide-react";

/** Ce que la recherche a coute et trouve, a chaque etape. */
export interface ScanStats {
  /** Entreprises correspondant aux critères dans l'annuaire. */
  total: number;
  /** Candidats passés au scan Linkup (phase 1). */
  scanned: number;
  /** Parmi eux, ceux portant au moins un signal attesté. */
  withSignal: number;
  /** Fiches Pappers réellement ouvertes (phase 2). */
  analysed: number;
  /** Plafond demandé par l'utilisateur. */
  requested: number;
  /** Appels Linkup perdus : ni chaudes, ni froides. */
  unverified?: number;
  /** `true` quand l'annuaire plafonne son total : « plus de 10 000 ». */
  totalCapped?: boolean;
  /** Zone réellement appliquée (« Paris (75) »). */
  zoneLabel?: string | null;
  /** Entreprises écartées parce que déjà vues. */
  skippedKnown?: number;
  /** Pages d'annuaire lues. */
  pagesRead?: number;
  /** Pourquoi la boucle s'est arrêtée, en clair. */
  stopReason?: string;
  /** Entreprises enrichies puis écartées : effectif hors de la tranche. */
  outOfBracket?: string[];
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-data text-sm font-semibold text-text">{value}</span>
      <span className="text-[12px] text-muted">{label}</span>
    </span>
  );
}

/**
 * Compte rendu du scan.
 *
 * Il dit la vérité sur la rareté des signaux plutôt que de combler la liste
 * avec des entreprises froides : si peu d'entreprises bougent, l'écran le
 * montre et oriente vers un élargissement des critères.
 */
export function ScanSummary({ scan }: { scan: ScanStats }) {
  const nothing = scan.withSignal === 0;
  const short = scan.withSignal > 0 && scan.withSignal < scan.requested;
  const more = scan.withSignal > scan.analysed;

  return (
    <section
      className="rounded-xl border p-4"
      style={{
        borderColor: nothing ? "var(--warn)" : "var(--line)",
        background: nothing ? "var(--warn-soft)" : "var(--surface)",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-1.5">
          {nothing ? (
            <SearchX className="h-4 w-4 text-warn" aria-hidden />
          ) : (
            <Radar className="h-4 w-4 text-primary" aria-hidden />
          )}
          <span className="text-[13px] font-medium text-text">Scan terminé</span>
        </span>

        <Figure value={scan.scanned} label="scannées" />
        <Figure value={scan.withSignal} label="avec signal" />
        <Figure value={scan.analysed} label="fiches ouvertes" />
        {/* Un appel perdu n'est pas une entreprise froide : il se compte a part. */}
        {scan.unverified ? (
          <span className="flex items-baseline gap-1.5">
            <span className="font-data text-sm font-semibold text-warn-ink">{scan.unverified}</span>
            <span className="text-[12px] text-muted">non vérifiées</span>
          </span>
        ) : null}

        {scan.total > scan.scanned && (
          <span className="text-[12px] text-faint">
            {/* L'annuaire plafonne son compteur a 10 000 : on ne fait pas passer
                ce plafond pour un decompte exact. */}
            sur {scan.totalCapped ? "plus de 10 000" : scan.total} entreprise
            {scan.total > 1 ? "s" : ""} correspondant aux critères
            {scan.zoneLabel ? ` · ${scan.zoneLabel}` : ""}
          </span>
        )}
      </div>

      {/* Hors tranche : elles ont coûté un enrichissement, on dit lesquelles
          et pourquoi plutôt que de les faire disparaître en silence. */}
      {scan.outOfBracket && scan.outOfBracket.length > 0 && (
        <details className="mt-2.5">
          <summary className="cursor-pointer text-[13px] text-muted">
            {scan.outOfBracket.length} entreprise{scan.outOfBracket.length > 1 ? "s" : ""} écartée
            {scan.outOfBracket.length > 1 ? "s" : ""} : effectif hors de la tranche demandée
          </summary>
          <ul className="mt-1 space-y-0.5 text-[12px] text-faint">
            {scan.outOfBracket.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}

      {(scan.stopReason || scan.skippedKnown || scan.pagesRead) && (
        <p className="mt-2 font-data text-[11px] text-faint">
          {[
            scan.pagesRead ? `${scan.pagesRead} page(s) d'annuaire lues` : null,
            scan.skippedKnown ? `${scan.skippedKnown} déjà connue(s), non rescannée(s)` : null,
            scan.stopReason ? `arrêt : ${scan.stopReason}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {nothing && (
        <p className="mt-2.5 text-[13px] leading-snug text-text">
          Sur {scan.scanned} entreprise{scan.scanned > 1 ? "s" : ""} scannée
          {scan.scanned > 1 ? "s" : ""}, aucune ne porte de signal récent. Aucune fiche n&apos;a été
          ouverte — élargissez les critères (secteur, zone, mot-clé) ou augmentez la largeur de scan.
        </p>
      )}

      {short && (
        <p className="mt-2.5 text-[13px] leading-snug text-muted">
          Sur {scan.scanned} entreprises scannées, seulement {scan.withSignal} porte
          {scan.withSignal > 1 ? "nt" : ""} un signal récent. Élargissez les critères (secteur,
          zone, mot-clé) pour en trouver davantage.
        </p>
      )}

      {more && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[13px] leading-snug text-muted">
          <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          {scan.withSignal} entreprises ont un signal, {scan.analysed} ont été ouvertes. Augmentez
          « Fiches à ouvrir » pour en analyser plus.
        </p>
      )}
    </section>
  );
}
