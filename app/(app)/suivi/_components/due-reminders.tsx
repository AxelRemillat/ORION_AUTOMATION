"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, Check } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ProspectStatusBadge, useToast } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { setReminderDone } from "../actions";
import type { DueReminderRow } from "../_lib/rows";

/** Bandeau « à relancer aujourd'hui », en tête de la page Suivi. */
export function DueReminders({ reminders }: { reminders: DueReminderRow[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (reminders.length === 0) return null;

  const markDone = (id: string) =>
    startTransition(async () => {
      const result = await setReminderDone(id, true);
      if (result.ok) {
        toast.success("Relance marquée comme faite.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const isLate = (dueAt: string) => new Date(dueAt) < new Date(new Date().toDateString());

  return (
    <Card className="mb-6 border-accent/40">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <AlarmClock className="h-4 w-4 text-accent" aria-hidden />
        <CardTitle>À relancer aujourd&apos;hui</CardTitle>
        <Badge tone="accent" className="ml-1">
          {reminders.length}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {reminders.map((reminder) => (
          <div
            key={reminder.id}
            className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface-2/60 px-3 py-2"
          >
            <Link
              href={`/suivi/${reminder.prospectId}`}
              className="text-sm font-medium text-fg hover:text-accent"
            >
              {reminder.companyName}
            </Link>
            <ProspectStatusBadge status={reminder.status} />
            <span className="text-[13px] text-muted">
              {isLate(reminder.dueAt) ? "En retard depuis le" : "Due le"} {formatDate(reminder.dueAt)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => markDone(reminder.id)} disabled={pending}>
                <Check className="h-3.5 w-3.5" aria-hidden />
                Fait
              </Button>
              <Link href={`/suivi/${reminder.prospectId}`}>
                <Button variant="secondary" size="sm">
                  Relancer
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
