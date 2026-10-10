import Link from "next/link";
import { Search } from "lucide-react";
import type { Capacity } from "@/lib/today/capacity";
import type { TodayItem } from "@/lib/today/types";
import { RunNowButton } from "./run-now-button";
import { YieldButton } from "./yield-button";
import type { YieldPlan } from "@/lib/today/yield";

/**
 * En-tête : la date, ce que la préparation a mis de côté, l'avancement du
 * tri (« N / total traités ») et « Lancer maintenant ».
 */

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

export function TodayHeader({
  today,
  items,
  capacity,
  liveJobId,
  alert = null,
  blockedReason = null,
  dailyTarget,
  onFinished,
  yieldPlan = null,
}: {
  today: string;
  items: TodayItem[];
  capacity: Capacity;
  liveJobId: string | null;
  /** Échec de la dernière préparation : affiché tel quel, en rouge. */
  alert?: string | null;
  /** Plafond OpenAI atteint : « Lancer maintenant » affiche pourquoi. */
  blockedReason?: string | null;
  dailyTarget: number;
  onFinished: () => void;
  /** « Céder la place aux relances » (Cowork #42) : plafond engagé et relances validées en attente. */
  yieldPlan?: YieldPlan | null;
}) {
  const count = (kind: TodayItem["kind"]) => items.filter((item) => item.kind === kind).length;
  const treated = items.filter((item) => item.status !== "todo").length;
  const pct = items.length ? Math.round((treated / items.length) * 100) : 0;
  const date = new Date(`${today}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  /*
   * Le plafond porte sur le JOUR D ENVOI (capacity.day), qui n est pas la date
   * du titre : un samedi, la programmation vise le lundi. On le dit, au lieu de
   * laisser croire que le plafond du jour affiche est atteint.
   */
  const sendLabel =
    capacity.day === today
      ? "aujourd’hui"
      : new Date(`${capacity.day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <header className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold capitalize tracking-tight text-text">{date}</h1>
          <p className="text-[13px] text-muted">
            Préparé : {plural(count("reponse"), "réponse", "réponses")}, {plural(count("relance"), "relance", "relances")},{" "}
            {plural(count("nouveau"), "nouveau", "nouveaux")}, {count("a_completer")} à compléter
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full border border-line bg-surface px-2.5 py-1 font-data text-[11px] text-muted"
            title={`${capacity.sentToday} envoyé(s), ${capacity.plannedToday} déjà programmé(s) pour le ${sendLabel}, plafond ${capacity.dailyCap}`}
          >
            envois {capacity.sentToday}
            {capacity.plannedToday > 0 && ` + ${capacity.plannedToday} prog.`}/{capacity.dailyCap}
          </span>
          {capacity.remaining === 0 && (
            /*
             * Sans cette phrase, « 16/25 » laissait croire à des places libres :
             * les créneaux restants étaient pris par des envois programmés.
             *
             * Et elle NOMME le jour : la capacité porte sur le prochain jour
             * ouvré, pas sur la date affichée en titre. Un samedi, « plus aucun
             * créneau aujourd'hui » parlait en réalité du lundi.
             */
            <span className="rounded-full border border-warn/25 bg-warn/10 px-2.5 py-1 font-data text-[11px] text-warn-ink">
              plafond engagé · plus aucun créneau {sendLabel}
            </span>
          )}
          {yieldPlan && <YieldButton plan={yieldPlan} onDone={onFinished} />}
          {capacity.warmupDay !== null && (
            <span className="rounded-full border border-line bg-surface px-2.5 py-1 font-data text-[11px] text-muted">
              montée en charge · jour {capacity.warmupDay}
            </span>
          )}
          <RunNowButton liveJobId={liveJobId} dailyTarget={dailyTarget} onFinished={onFinished} blockedReason={blockedReason} />
          {/*
            La recherche manuelle n'a plus d'onglet : elle s'ouvre ici, à côté
            de « Lancer maintenant », parce qu'elle sert au même moment et au
            même but — trouver des prospects — mais une fois sur dix.
          */}
          <Link
            href="/recherche"
            title="Signaux, critères, scan, ajout manuel, favoris"
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            Recherche avancée
          </Link>
        </div>
      </div>
      {alert && (
        <p role="alert" className="rounded-lg border border-lost/25 bg-lost/10 px-3 py-2 text-[13px] text-lost-ink">
          {alert}
        </p>
      )}
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avancement du tri">
          <div className="h-full rounded-full bg-brand-grad transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-data text-[12px] text-muted sm:shrink-0">
          {treated} / {items.length} traités
          {items.length - treated > 0 && ` · ~${items.length - treated} min restantes`}
        </span>
      </div>
    </header>
  );
}
