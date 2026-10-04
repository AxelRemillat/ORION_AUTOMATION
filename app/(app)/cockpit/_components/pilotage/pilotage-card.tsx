"use client";

import { useMemo, useState } from "react";
import { Gauge } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { niceTicks } from "@/lib/charts/nice-ticks";
import { PROVIDER_LABELS, PROVIDERS, type Consumption, type Provider } from "@/lib/usage/consumption";
import type { CreditTile } from "@/lib/usage/credits";
import type { OpenAiBudgetState } from "@/lib/usage/budgets";
import type { Readiness } from "@/lib/usage/readiness";
import { ReadinessTiles } from "./readiness-tiles";

/**
 * Bloc « Pilotage » : consommation par fournisseur sur 30 jours (barres
 * empilées, bascule requêtes ↔ €), crédits restants, totaux du mois et
 * projection. Les agrégats arrivent tout faits du serveur (lib/usage/pilotage).
 */

/** Couleurs par fournisseur : uniquement des tokens du design system. */
const COLORS: Record<Provider, string> = {
  openai: "var(--primary)",
  hunter: "var(--warn)",
  pappers: "rgb(var(--rgb-violet))",
  linkup: "var(--cyan)",
  gratuit: "var(--faint)",
};

type Mode = "calls" | "eur";

const eur = (value: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: value < 10 ? 2 : 0 }).format(value);
const count = (value: number) => new Intl.NumberFormat("fr-FR", { notation: value >= 10_000 ? "compact" : "standard" }).format(value);

const W = 720;
const H = 200;
const PAD = { top: 10, right: 8, bottom: 22, left: 40 };

function Chart({ consumption, mode }: { consumption: Consumption; mode: Mode }) {
  const days = consumption.days;
  const totals = days.map((day) => PROVIDERS.reduce((sum, provider) => sum + day[mode][provider], 0));
  const max = Math.max(...totals, 0);
  const scale = useMemo(() => niceTicks(max, { integer: mode === "calls", count: 4 }), [max, mode]);
  const top = scale.max > 0 ? scale.max : 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / days.length;
  const barW = Math.max(2, slot * 0.68);
  const y = (value: number) => PAD.top + innerH - (value / top) * innerH;
  const label = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Consommation par fournisseur sur 30 jours, en ${mode === "eur" ? "euros" : "requêtes"}`}>
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--line-soft)" strokeWidth={1} />
          <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end" className="font-data" fontSize={10} fill="var(--faint)">
            {mode === "eur" ? eur(tick) : count(tick)}
          </text>
        </g>
      ))}
      {days.map((day, index) => {
        let base = 0;
        const x = PAD.left + index * slot + (slot - barW) / 2;
        return (
          <g key={day.day}>
            <title>
              {`${label(day.day)} — ${PROVIDERS.filter((provider) => day.calls[provider] > 0)
                .map((provider) => `${PROVIDER_LABELS[provider]} : ${mode === "eur" ? eur(day.eur[provider]) : `${day.calls[provider]} req.`}`)
                .join(" · ") || "aucune consommation"}${day.tokens ? ` · ${count(day.tokens)} tokens OpenAI` : ""}`}
            </title>
            {PROVIDERS.map((provider) => {
              const value = day[mode][provider];
              if (value <= 0) return null;
              const y0 = y(base);
              base += value;
              const y1 = y(base);
              return <rect key={provider} x={x} y={y1} width={barW} height={Math.max(0.5, y0 - y1)} rx={1.5} fill={COLORS[provider]} />;
            })}
            {/* Zone de survol pleine hauteur : l'info-bulle répond même sur une barre vide. */}
            <rect x={PAD.left + index * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
            {(index % 7 === 0 || index === days.length - 1) && (
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="font-data" fontSize={10} fill="var(--faint)">
                {label(day.day)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function CreditTileView({ tile }: { tile: CreditTile }) {
  const ratio = tile.total && tile.remaining !== null ? Math.max(0, Math.min(1, tile.remaining / tile.total)) : null;
  const low = ratio !== null && ratio < 0.15;
  const value =
    tile.key === "openai"
      ? tile.remaining !== null
        ? `${eur(tile.remaining)} restants`
        : `${eur(tile.used)} ce mois`
      : tile.remaining !== null
        ? `${count(tile.remaining)}${tile.total ? ` / ${count(tile.total)}` : ""}`
        : "—";
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface-2/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-text">{tile.label}</span>
        {tile.quality === "estime" && (
          <span className="rounded-full border border-warn/25 bg-warn/10 px-1.5 py-0.5 text-[11px] text-warn-ink">estimé</span>
        )}
      </div>
      <span className={`font-data text-[18px] ${low ? "text-lost-ink" : "text-text"}`}>{value}</span>
      {ratio !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
          <div className="h-full rounded-full" style={{ width: `${Math.round(ratio * 100)}%`, background: low ? "var(--lost)" : "var(--good)" }} />
        </div>
      )}
      <span className="text-[11px] leading-snug text-faint">{tile.basis}</span>
    </div>
  );
}

export function PilotageCard({
  consumption,
  credits,
  openai = null,
  readiness = null,
  target = null,
}: {
  consumption: Consumption;
  credits: CreditTile[];
  /** Mails prêts / jour et coût par mail prêt (30 jours). */
  readiness?: Readiness | null;
  /** « Mails prêts visés par jour » (Réglages › Paramètres). */
  target?: number | null;
  /** Plafond OpenAI : alerte à 80 %, préparation arrêtée à 100 %. */
  openai?: OpenAiBudgetState | null;
}) {
  const [mode, setMode] = useState<Mode>("calls");
  const { month, window } = consumption;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" aria-hidden />
            Pilotage
          </CardTitle>
          <CardDescription>Consommation des fournisseurs sur 30 jours, crédits restants et dépense du mois.</CardDescription>
        </div>
        <div className="flex rounded-lg border border-line p-0.5 text-[12px]" role="group" aria-label="Unité du graphe">
          {(["calls", "eur"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={`rounded-md px-2.5 py-1 ${mode === option ? "bg-primary/15 text-primary-ink" : "text-muted hover:text-text"}`}
            >
              {option === "calls" ? "Requêtes" : "€"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {openai?.message && (
          <p
            role="alert"
            className={`rounded-lg border px-3 py-2 text-[13px] ${
              openai.level === "plafond" ? "border-lost/25 bg-lost/10 text-lost-ink" : "border-warn/25 bg-warn/10 text-warn-ink"
            }`}
          >
            {openai.message}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line p-3">
            <span className="text-[12px] text-muted">Dépense de {month.label}</span>
            <span className="font-data text-[22px] text-text">{eur(month.eur)}</span>
            <span className="text-[11px] text-faint">
              {`jour ${month.daysElapsed} / ${month.daysInMonth} · projection fin de mois `}
              <span className="font-data text-muted">{eur(month.projection)}</span>
            </span>
          </div>
          {credits.map((tile) => (
            <CreditTileView key={tile.key} tile={tile} />
          ))}
        </div>

        {readiness && <ReadinessTiles readiness={readiness} target={target} />}

        {consumption.empty ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
            Aucune consommation journalisée sur les 30 derniers jours : le graphe se remplira au premier enrichissement ou au premier brouillon.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <Chart consumption={consumption} mode={mode} />
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted" aria-label="Totaux sur 30 jours">
              {PROVIDERS.map((provider) => (
                <li key={provider} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLORS[provider] }} aria-hidden />
                  <span className="text-text">{PROVIDER_LABELS[provider]}</span>
                  <span className="font-data">
                    {mode === "eur" ? eur(window.eur[provider]) : `${count(window.calls[provider])} req.`}
                    {provider === "openai" && window.tokens > 0 && ` · ${count(window.tokens)} tokens`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
