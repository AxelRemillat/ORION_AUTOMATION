import { ShieldCheck, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui";
import type { Deliverability } from "../_lib/deliverability";

const LEVEL_TOKEN = {
  ok: "var(--good)",
  warn: "var(--warn)",
  blocked: "var(--lost)",
} as const;

/**
 * Garde-fous d'envoi : volumes réellement envoyés (comptés en base) face au
 * plafond de la règle de warmup interne. La jauge se peint au dégradé de
 * marque tant qu'on est dans les clous, et vire à la couleur sémantique dès
 * que le plafond approche.
 */
export function DeliverabilityBanner({ data }: { data: Deliverability }) {
  const color = LEVEL_TOKEN[data.level];
  const filled = data.dailyCap > 0 ? Math.min(data.sentToday / data.dailyCap, 1) : 0;
  const Icon = data.level === "ok" ? ShieldCheck : TriangleAlert;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Icon className="h-4 w-4 shrink-0" style={{ color }} aria-hidden />

        <p className="text-[13px] text-text">
          <span className="font-data">{data.sentToday}</span>
          <span className="text-muted"> / {data.dailyCap} envois aujourd&apos;hui</span>
        </p>

        <div
          className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full"
          style={{ background: "var(--line-soft)" }}
          role="img"
          aria-label={`${data.sentToday} envois sur un plafond de ${data.dailyCap}`}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(filled * 100, data.sentToday > 0 ? 4 : 0)}%`,
              background: data.level === "ok" ? "var(--accent-grad)" : color,
            }}
          />
        </div>

        <p className="text-[12px] text-muted">
          {data.warmupDay === null
            ? "Adresse jamais utilisée : commencez doucement, une dizaine d'envois par jour."
            : data.warmingUp
              ? `Warmup jour ${data.warmupDay} · ${data.sentLast7} envois sur 7 jours`
              : `Adresse chauffée · ${data.sentLast7} envois sur 7 jours`}
        </p>
      </div>

      {data.level !== "ok" && (
        <p className="mt-2 text-[12px]" style={{ color }}>
          {data.level === "blocked"
            ? "Plafond du jour atteint : reprenez demain pour ne pas dégrader la réputation de l'adresse."
            : `Encore ${data.remaining} envoi(s) avant le plafond du jour.`}
        </p>
      )}

      <p className="mt-2 text-[11px] text-faint">
        Volumes réels comptés sur les messages envoyés. Les plafonds sont une règle interne
        (montée en charge sur 14 jours), ajustable dans `lib/outbox/deliverability.ts`.
      </p>
    </Card>
  );
}
