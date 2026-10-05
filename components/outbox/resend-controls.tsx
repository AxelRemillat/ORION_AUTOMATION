"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { prepareResendMail, resendMail } from "@/lib/outbox/actions";
import { ScheduleDialog } from "./schedule-dialog";

/**
 * Mail en ÉCHEC : « Renvoyer » (tout de suite) ou « Programmer ». Action
 * manuelle, même contenu et même destinataire ; garde-fous côté serveur
 * (opposé, « stop », non joignable, déjà parti, historique).
 */
export function ResendControls({
  messageId,
  to,
  compact = false,
  onDone,
}: {
  messageId: string;
  /** Destinataire de la tentative ratée. */
  to: string | null;
  /** Liste : le seul bouton « Renvoyer », sans « Programmer ». */
  compact?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function resend() {
    start(async () => {
      const result = await resendMail(messageId);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Mail renvoyé.");
      onDone?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={resend} loading={pending} disabled={!to} title={to ? `Renvoyer à ${to}` : "Destinataire inconnu : programmez pour le saisir"}>
        <RotateCw className="h-3.5 w-3.5" aria-hidden />
        Renvoyer
      </Button>
      {!compact && (
        <ScheduleDialog
          messageId={messageId}
          defaultTo={to ?? ""}
          scheduledTo={to}
          prepare={() => prepareResendMail(messageId)}
          onScheduled={onDone}
        />
      )}
    </div>
  );
}
