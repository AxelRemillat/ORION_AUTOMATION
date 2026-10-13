"use client";

import { useState } from "react";
import { costLabel, FIRST_DRAFT_COST_EUR } from "@/lib/usage/draft-estimate";
import { Loader2, PenLine } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { startJob, watchJob } from "@/lib/jobs/client";
import type { TodayItem } from "@/lib/today/types";
import { generateFollowUp } from "../../suivi/actions";
import { draftReplyToday } from "../actions";

/**
 * Pas encore de brouillon : on le demande ici, avec le même générateur que la
 * préparation du matin (intro : job `email_generate` sans second appel Hunter ;
 * relance : dans le fil ; réponse : prompt de réponse). Rien n'est envoyé.
 */
export function MissingDraft({ item, onDone }: { item: TodayItem; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (item.draftPending) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-line-soft bg-surface-2/60 p-3 text-[13px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Brouillon en cours de rédaction…
      </p>
    );
  }

  async function generate() {
    if (!item.prospectId && !item.inboundId) return;
    setBusy(true);
    try {
      if (item.kind === "reponse" && item.inboundId) {
        const result = await draftReplyToday(item.inboundId);
        if (!result.ok) throw new Error(result.error);
      } else if (item.kind === "relance" && item.followUpType) {
        const result = await generateFollowUp(item.prospectId!, item.followUpType);
        if (!result.ok) throw new Error(result.error);
      } else {
        const id = await startJob(
          "email_generate",
          { prospectId: item.prospectId!, label: `Mail ${item.companyName}` },
          { prospectId: item.prospectId, mode: "full", saveDraft: true, storedContact: true },
        );
        const snapshot = await watchJob(id);
        if (snapshot?.job.status === "failed") throw new Error(snapshot.job.error ?? "Génération impossible.");
      }
      toast.success("Brouillon prêt.");
      onDone();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Génération impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft bg-surface-2/60 p-3">
      <p className="text-[13px] text-muted">Aucun brouillon pour l&apos;instant.</p>
      <Button size="sm" variant="secondary" loading={busy} onClick={generate} disabled={item.kind !== "reponse" && !item.contact.email} title={`Coût OpenAI estimé : ${costLabel(FIRST_DRAFT_COST_EUR)}`}>
        <PenLine className="h-3.5 w-3.5" aria-hidden /> Rédiger le brouillon
      </Button>
    </div>
  );
}
