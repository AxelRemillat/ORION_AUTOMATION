"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Modal, ProspectStatusBadge, useToast } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { daysBeforePurge } from "@/lib/trash/retention";
import { PROSPECT_STATUSES, type Prospect, type ProspectStatus } from "@/types";
import { deleteProspectForever, restoreProspect } from "../actions";

/** Prospects à la corbeille, avec restauration et suppression définitive. */
export function TrashList({ prospects }: { prospects: Prospect[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Prospect | null>(null);

  if (!prospects.length) {
    return (
      <EmptyState
        icon={<Trash2 />}
        title="Corbeille vide"
        description="Les prospects mis à la corbeille depuis la Prospection ou le Suivi apparaîtront ici."
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
        {prospects.map((prospect) => {
          const left = prospect.deleted_at ? daysBeforePurge(prospect.deleted_at) : 0;
          const before = prospect.status_before_delete as ProspectStatus | null;
          return (
            <div key={prospect.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-[220px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-text">{prospect.company_name}</span>
                  {before && PROSPECT_STATUSES.includes(before) && <ProspectStatusBadge status={before} />}
                </div>
                <p className="mt-0.5 text-[12px] text-faint">
                  Supprimé le {formatDate(prospect.deleted_at)} ·{" "}
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
                  onClick={() => run(() => restoreProspect(prospect.id), `« ${prospect.company_name} » restauré.`)}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Restaurer
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(prospect)}>
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
        description={
          confirming
            ? `« ${confirming.company_name} » sera effacé avec ses messages, deals, relances et brief. Son SIREN ne sera plus proposé par la recherche (réversible dans l'onglet « Exclus »).`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                confirming &&
                run(() => deleteProspectForever(confirming.id), `« ${confirming.company_name} » supprimé définitivement.`)
              }
            >
              Supprimer définitivement
            </Button>
          </>
        }
      />
    </>
  );
}
