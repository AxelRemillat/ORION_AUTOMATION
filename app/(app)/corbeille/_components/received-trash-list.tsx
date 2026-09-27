"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Card, Modal, useToast } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { daysBeforePurge } from "@/lib/trash/retention";
import { deleteReceivedForever, restoreReceived } from "@/lib/outbox/actions";
import type { InboundMessage } from "@/types";

/** Mails REÇUS à la corbeille : restaurer ou supprimer définitivement. */
export function ReceivedTrashList({ items, names }: { items: InboundMessage[]; names: Record<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<InboundMessage | null>(null);

  if (!items.length) return <p className="px-1 text-[13px] text-faint">Aucun mail reçu à la corbeille.</p>;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? "Opération impossible.");
      setConfirming(null);
      router.refresh();
    });
  }

  const from = (item: InboundMessage) => (item.prospect_id && names[item.prospect_id]) || item.from_email;

  return (
    <>
      <Card className="divide-y divide-line-soft">
        {items.map((item) => {
          const left = item.deleted_at ? daysBeforePurge(item.deleted_at) : 0;
          return (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-[220px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-text">{item.subject || "(sans objet)"}</span>
                  <Badge tone="warning">Reçu</Badge>
                </div>
                <p className="mt-0.5 text-[12px] text-faint">
                  De {from(item)} · supprimé le {formatDate(item.deleted_at)} ·{" "}
                  <Badge tone={left <= 2 ? "warning" : "neutral"}>
                    {left === 0 ? "suppression définitive aujourd'hui" : `suppression définitive dans ${left} jour${left > 1 ? "s" : ""}`}
                  </Badge>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => restoreReceived(item.id), "Mail reçu restauré.")}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Restaurer
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(item)}>
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
        description={confirming ? `Le mail reçu de ${from(confirming)} sera effacé. Impossible de revenir en arrière.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => confirming && run(() => deleteReceivedForever(confirming.id), "Mail reçu supprimé définitivement.")}
            >
              Supprimer définitivement
            </Button>
          </>
        }
      />
    </>
  );
}
