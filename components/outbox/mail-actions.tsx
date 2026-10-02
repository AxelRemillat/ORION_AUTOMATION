"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarX } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { confirmOppositionChecked, unscheduleMail } from "@/lib/outbox/actions";
import type { SendStatus } from "@/types";
import { MailTrashButton } from "./mail-trash-button";
import { ScheduleDialog } from "./schedule-dialog";
import { SendStateBadge } from "./send-state-badge";

export interface MailSendState {
  messageId: string;
  sendStatus?: SendStatus | null;
  scheduledAt?: string | null;
  scheduledTo?: string | null;
  sendError?: string | null;
}

/**
 * Actions d'un brouillon non envoyé : état d'envoi, programmer / modifier
 * l'heure, annuler la programmation (retour en brouillon), corbeille.
 * Rien n'est proposé pendant l'envoi ni après : l'historique ne se touche pas.
 */
export function MailActions({
  state,
  defaultTo,
  label,
  onTrashed,
  onChanged,
  suggestions,
  refusesProspecting = false,
  oppositionUnverified = false,
  prospectId,
}: {
  state: MailSendState;
  defaultTo: string;
  suggestions?: { email: string; source: string }[];
  /**
   * L'entreprise s'est OPPOSÉE à l'usage commercial de ses données au registre.
   * Programmer un envoi n'est alors pas une question de tri : le bouton est
   * retiré, et l'écran dit pourquoi.
   */
  refusesProspecting?: boolean;
  /**
   * Aucune source (Pappers, INPI) n'a pu vérifier l'opposition : « Programmer »
   * reste désactivé jusqu'à la vérification — au run suivant de l'entonnoir, ou
   * par la case « j'ai vérifié manuellement » (qui demande `prospectId`).
   */
  oppositionUnverified?: boolean;
  prospectId?: string;
  /** Nom du mail dans les toasts (« le brouillon pour ACME »). */
  label?: string;
  onTrashed?: () => void;
  /** Programmation posée ou annulée : l'appelant peut relire l'état. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [verified, setVerified] = useState(false);
  const [verifying, startVerify] = useTransition();
  const status = state.sendStatus ?? "draft";
  if (status === "sent" || status === "sending") {
    return <SendStateBadge sendStatus={status} />;
  }
  const scheduled = status === "scheduled";

  function unschedule() {
    startTransition(async () => {
      const result = await unscheduleMail(state.messageId);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Programmation annulée : le mail redevient un brouillon.");
      onChanged?.();
      router.refresh();
    });
  }

  const blocked = oppositionUnverified && !verified;

  function confirmVerified() {
    if (!prospectId) return;
    startVerify(async () => {
      const result = await confirmOppositionChecked(prospectId);
      if (!result.ok) return void toast.error(result.error);
      setVerified(true);
      toast.success("Opposition vérifiée : l'envoi peut être programmé.");
      onChanged?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SendStateBadge sendStatus={status} scheduledAt={state.scheduledAt} sendError={state.sendError} />
      {(status === "failed" || status === "blocked") && state.sendError && (
        <span className="max-w-[320px] truncate text-[12px] text-lost-ink" title={state.sendError}>
          {state.sendError}
        </span>
      )}
      {refusesProspecting ? (
        <span className="rounded-full border border-lost/25 bg-lost/10 px-2 py-0.5 text-[12px] text-lost-ink">
          opposé à la prospection : envoi désactivé
        </span>
      ) : (
      <>
        {blocked && (
          <span
            className="rounded-full border border-warn/25 bg-warn/10 px-2 py-0.5 text-[12px] text-warn-ink"
            title="Ni Pappers ni l'INPI n'ont pu dire si l'entreprise s'oppose à la prospection. Revérifiée au prochain run de l'entonnoir."
          >
            opposition non vérifiée
          </span>
        )}
        <ScheduleDialog
          messageId={state.messageId}
          defaultTo={defaultTo}
          scheduledAt={scheduled ? state.scheduledAt : null}
          scheduledTo={state.scheduledTo}
          onScheduled={onChanged}
          suggestions={suggestions}
          disabled={blocked}
        />
        {blocked && prospectId && (
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            <input type="checkbox" checked={false} disabled={verifying} onChange={confirmVerified} />
            j&apos;ai vérifié manuellement
          </label>
        )}
      </>
      )}
      {(scheduled || status === "blocked") && (
        <Button size="sm" variant="ghost" onClick={unschedule} loading={pending}>
          <CalendarX className="h-3.5 w-3.5" aria-hidden />
          Annuler l&apos;envoi programmé
        </Button>
      )}
      <MailTrashButton messageId={state.messageId} label={label} onTrashed={onTrashed} />
    </div>
  );
}
