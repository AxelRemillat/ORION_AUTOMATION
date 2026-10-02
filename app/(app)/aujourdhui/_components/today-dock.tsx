"use client";

import { CalendarClock, CheckCheck, Keyboard } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Barre du bas : combien de mails validés attendent, la règle d'envoi, et le
 * geste final « Programmer N envois ». Rien ne part sans passer par là.
 */
export function TodayDock({
  validated,
  remaining,
  checked,
  onValidateChecked,
  onSchedule,
  onHelp,
}: {
  validated: number;
  remaining: number;
  checked: number;
  onValidateChecked: () => void;
  onSchedule: () => void;
  onHelp: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-line bg-surface/90 px-4 py-3 backdrop-blur-md md:-mx-6 md:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text">
            {validated} mail{validated > 1 ? "s" : ""} validé{validated > 1 ? "s" : ""}
          </p>
          <p className="text-[12px] text-muted">
            Envoi réparti entre 9 h et 17 h, 2 à 7 min d&apos;écart · {remaining} envoi{remaining > 1 ? "s" : ""} encore possible
            {remaining > 1 ? "s" : ""} aujourd&apos;hui
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onHelp} aria-keyshortcuts="?">
          <Keyboard className="h-3.5 w-3.5" aria-hidden /> Raccourcis
        </Button>
        {checked > 0 && (
          <Button size="sm" variant="outline" onClick={onValidateChecked}>
            <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Valider la sélection ({checked})
          </Button>
        )}
        <Button onClick={onSchedule} disabled={!validated}>
          <CalendarClock className="h-4 w-4" aria-hidden /> Programmer {validated} envoi{validated > 1 ? "s" : ""}
        </Button>
      </div>
    </div>
  );
}
