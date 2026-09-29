"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button, Input, Label, Modal, useToast } from "@/components/ui";
import { scheduleMail } from "@/lib/outbox/actions";
import { RecipientField } from "./recipient-field";
import {
  formatScheduled,
  parisToUtc,
  scheduleError,
  scheduleShortcuts,
  utcToParis,
} from "@/lib/outbox/paris-time";

/**
 * « Programmer l'envoi » : destinataire, date et heure À PARIS, raccourcis
 * « Demain 9h » / « Lundi 9h ». La date passée est refusée ici ET côté
 * serveur (lib/outbox/scheduler.ts).
 */
export function ScheduleDialog({
  messageId,
  defaultTo,
  scheduledAt,
  scheduledTo,
  onScheduled,
  prepare,
  disabled,
  suggestions = [],
}: {
  /** `null` : le mail n'existe pas encore en base, `prepare` le crée. */
  messageId: string | null;
  /** Enregistre le mail juste avant de le programmer (réponse en cours de saisie). */
  prepare?: () => Promise<{ ok: true; messageId: string } | { ok: false; error: string }>;
  disabled?: boolean;
  defaultTo: string;
  /** Présent : on modifie l'heure d'un mail déjà programmé. */
  scheduledAt?: string | null;
  scheduledTo?: string | null;
  onScheduled?: () => void;
  /** Adresses TROUVÉES pour ce prospect, avec leur source (jamais devinées). */
  suggestions?: { email: string; source: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const initial = scheduledAt ? utcToParis(new Date(scheduledAt)) : null;
  const [to, setTo] = useState(scheduledTo ?? defaultTo);
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time ?? "09:00");
  const [error, setError] = useState<string | null>(null);
  const shortcuts = useMemo(() => (open ? scheduleShortcuts() : []), [open]);

  const at = date ? parisToUtc(date, time) : null;

  function pick(instant: Date) {
    const local = utcToParis(instant);
    setDate(local.date);
    setTime(local.time);
    setError(null);
  }

  function submit() {
    const invalid = scheduleError(at);
    if (invalid) return setError(invalid);
    startTransition(async () => {
      let id = messageId;
      if (prepare) {
        const prepared = await prepare();
        if (!prepared.ok) return setError(prepared.error);
        id = prepared.messageId;
      }
      if (!id) return setError("Mail introuvable.");
      const result = await scheduleMail(id, to, (at as Date).toISOString());
      if (!result.ok) return setError(result.error);
      // L'heure RÉELLE : espacée de 2 à 7 min d'un autre envoi, 8 h – 18 h les jours ouvrés.
      const real = result.scheduledAt;
      const moved = real !== (at as Date).toISOString();
      toast.success(`Envoi programmé : ${formatScheduled(real)} (heure de Paris)${moved ? ", décalé pour espacer les envois" : ""}.`);
      setOpen(false);
      onScheduled?.();
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          // Le destinataire saisi à côté (composeur de réponse) fait foi à l'ouverture.
          setTo(scheduledTo ?? defaultTo);
          setOpen(true);
        }}
      >
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        {scheduledAt ? "Modifier l'heure" : "Programmer l'envoi"}
      </Button>

      <Modal
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        title={scheduledAt ? "Modifier l'envoi programmé" : "Programmer l'envoi"}
        description="Le mail partira tout seul à l'heure dite (heure de Paris), même si l'app est fermée."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button onClick={submit} loading={pending} disabled={!to.trim() || !date}>
              Programmer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <RecipientField id={`schedule-to-${messageId ?? "new"}`} value={to} onChange={setTo} suggestions={suggestions} />
          <div className="flex flex-wrap gap-2">
            {shortcuts.map((shortcut) => (
              <Button key={shortcut.label} size="sm" variant="secondary" onClick={() => pick(shortcut.at)}>
                {shortcut.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`schedule-date-${messageId ?? "new"}`}>Date</Label>
              <Input
                id={`schedule-date-${messageId ?? "new"}`}
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <div>
              <Label htmlFor={`schedule-time-${messageId ?? "new"}`}>Heure (Paris)</Label>
              <Input
                id={`schedule-time-${messageId ?? "new"}`}
                type="time"
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  setError(null);
                }}
                error={error ?? undefined}
              />
            </div>
          </div>
          {at && !error && (
            <p className="text-[12px] text-faint">
              Départ demandé : {formatScheduled(at.toISOString())}, heure de Paris. Jamais avant 8 h, après 18 h ni le
              week-end ; espacé de 2 à 7 min d&apos;un autre envoi sur le même créneau.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
