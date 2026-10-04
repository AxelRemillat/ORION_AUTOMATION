"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { groupByDay, type HistoryEvent, type HistorySummary } from "@/lib/history/build";
import { HistoryEventRow } from "./history-event";
import { NoteForm } from "./note-form";

/**
 * « Historique » de la fiche : résumé en tête, chronologie regroupée par jour
 * (la plus récente d'abord), 20 événements puis « Voir plus », note manuelle.
 */

const PAGE = 20;

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const ago = (days: number | null) => (days === null ? "jamais" : days === 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`);

export function HistoryCard({
  prospectId,
  events,
  summary,
  nextAction,
}: {
  prospectId: string;
  events: HistoryEvent[];
  summary: HistorySummary;
  nextAction: string;
}) {
  const [shown, setShown] = useState(PAGE);
  const groups = groupByDay(events.slice(0, shown));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <History className="h-4 w-4 text-primary" aria-hidden />
        <CardTitle>Historique</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Mails envoyés", value: String(summary.sent) },
            { label: "Mails reçus", value: String(summary.received) },
            { label: "Dernier contact", value: ago(summary.lastContactDays) },
            { label: "Prochaine action", value: nextAction },
          ].map((item) => (
            <div key={item.label} className="min-w-0 rounded-lg border border-line bg-surface-2/60 px-3 py-2">
              <dt className="text-[11px] text-muted">{item.label}</dt>
              <dd className="truncate font-data text-[14px] text-text" title={item.value}>{item.value}</dd>
            </div>
          ))}
        </dl>

        <NoteForm prospectId={prospectId} />

        {events.length === 0 ? (
          <p className="text-[13px] text-faint">Rien encore : les envois, réponses et changements de statut s&apos;afficheront ici.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <section key={group.day} aria-label={dayLabel(group.day)}>
                <h3 className="mb-1 font-data text-[11px] uppercase tracking-wider text-faint first-letter:uppercase">{dayLabel(group.day)}</h3>
                <ol className="divide-y divide-line-soft">
                  {group.events.map((event) => (
                    <HistoryEventRow key={event.id} event={event} />
                  ))}
                </ol>
              </section>
            ))}
            {events.length > shown && (
              <button type="button" onClick={() => setShown(shown + PAGE)} className="self-start rounded-lg border border-line px-3 py-1.5 text-[13px] text-text hover:bg-surface-2">
                Voir plus ({events.length - shown} restants)
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
