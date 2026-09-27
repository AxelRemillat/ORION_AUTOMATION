"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Modal, useToast } from "@/components/ui";
import { MESSAGE_TYPE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { daysBeforePurge } from "@/lib/trash/retention";
import { deleteMailForever, restoreMail } from "@/lib/outbox/actions";
import type { TrashedMessage } from "@/lib/outbox/trash";

/** Mails à la corbeille : restaurer ou supprimer définitivement. */
export function MailTrashList({ items }: { items: TrashedMessage[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<TrashedMessage | null>(null);

  if (!items.length) {
    return (
      <EmptyState
        icon={<Mail />}
        title="Aucun brouillon à la corbeille"
        description="Les brouillons et mails programmés mis à la corbeille apparaîtront ici."
      />
    );
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? "Opération impossible.");
      setConfirming(null);
      router.refresh();
    });
  }

  return (
    <>
      <Card className="divide-y divide-line-soft">
        {items.map(({ message, companyName, prospectTrashed }) => {
          const left = message.deleted_at ? daysBeforePurge(message.deleted_at) : 0;
          return (
            <div key={message.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-[220px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-text">{message.subject || "(sans objet)"}</span>
                  <Badge>{MESSAGE_TYPE_LABELS[message.type]}</Badge>
                  {message.send_status === "cancelled" && <Badge tone="warning">Envoi programmé annulé</Badge>}
                </div>
                <p className="mt-0.5 text-[12px] text-faint">
                  {companyName}
                  {prospectTrashed ? " (prospect à la corbeille)" : ""} · supprimé le {formatDate(message.deleted_at)} ·{" "}
                  <Badge tone={left <= 2 ? "warning" : "neutral"}>
                    {left === 0 ? "suppression définitive aujourd'hui" : `suppression définitive dans ${left} jour${left > 1 ? "s" : ""}`}
                  </Badge>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  loading={pending}
                  onClick={() => run(() => restoreMail(message.id), "Mail restauré en brouillon.")}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Restaurer
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setConfirming({ message, companyName, prospectTrashed })}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Supprimer définitivement
                </Button>
              </div>
            </div>
          );
        })}
      </Card>

      <Modal
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title="Supprimer définitivement ?"
        description={confirming ? `Le mail pour « ${confirming.companyName} » sera effacé. Impossible de revenir en arrière.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => confirming && run(() => deleteMailForever(confirming.message.id), "Mail supprimé définitivement.")}
            >
              Supprimer définitivement
            </Button>
          </>
        }
      />
    </>
  );
}
