import { formatEur } from "@/lib/utils";
import type { WeeklyKpis } from "../_lib/types";

/**
 * Tuiles KPI. Toutes les valeurs sont calculées sur des lignes Supabase réelles :
 * aucune n'est simulée. `hint` dit sur quoi porte le calcul, pour qu'un chiffre
 * ne soit jamais ambigu.
 */
function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div
      className="shadow-mist rounded-xl border p-4"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p
        className="font-data mt-1.5 text-2xl font-semibold tracking-tight"
        style={{ color: "var(--text)" }}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p>
    </div>
  );
}

export function KpiRow({ kpis }: { kpis: WeeklyKpis }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="Messages envoyés"
        value={String(kpis.sentThisWeek)}
        hint="Sur les 7 derniers jours"
      />
      <Tile
        label="Taux de réponse"
        value={`${Math.round(kpis.replyRate * 100)} %`}
        hint={`${kpis.replied} réponse${kpis.replied > 1 ? "s" : ""} sur ${kpis.contacted} contacté${kpis.contacted > 1 ? "s" : ""}`}
      />
      <Tile
        label="Valeur pipeline"
        value={formatEur(kpis.pipelineValue)}
        hint={`${kpis.openDeals} deal${kpis.openDeals > 1 ? "s" : ""} encore ouvert${kpis.openDeals > 1 ? "s" : ""}`}
      />
      <Tile
        label="RDV en cours"
        value={String(kpis.meetings)}
        hint="Prospects au statut « En discussion »"
      />
    </div>
  );
}
