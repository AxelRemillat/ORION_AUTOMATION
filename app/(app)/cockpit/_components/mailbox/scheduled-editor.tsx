"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button, Label, Textarea, useToast } from "@/components/ui";
import { PreflightPanel } from "@/components/mail/preflight-panel";
import { SubjectField } from "@/components/mail/subject-field";
import { usePreflight } from "@/components/mail/use-preflight";
import { useSubjectReview } from "@/components/mail/use-subject-review";
import { applyFix } from "@/lib/mail-preflight";
import { editScheduledMail } from "@/lib/outbox/actions";
import type { ScheduledItem } from "@/lib/outbox/mailbox";

/** Repli : l'éditeur (et son contrôle) n'est monté qu'une fois ouvert — aucun appel sinon. */
export function ScheduledText({ item }: { item: ScheduledItem }) {
  const [open, setOpen] = useState(item.sendStatus === "blocked");
  return (
    <details className="w-full" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-[12px] text-muted">
        {item.sendStatus === "blocked" ? "Corriger le texte bloqué" : "Voir et modifier le texte"}
      </summary>
      {open && <ScheduledEditor item={item} />}
    </details>
  );
}

/**
 * Texte d'un mail programmé (relance comprise), relisible et modifiable avant
 * son départ. Il passe par le contrôle avant envoi, comme au départ réel.
 */
export function ScheduledEditor({ item }: { item: ScheduledItem }) {
  const router = useRouter();
  const toast = useToast();
  const [subject, setSubject] = useState(item.subject ?? "");
  const [body, setBody] = useState(item.body);
  const [pending, startTransition] = useTransition();
  const review = useSubjectReview(body);
  const check = usePreflight({
    subject,
    body,
    to: item.to,
    prospectId: item.prospectId,
    kind: item.type === "reponse" ? "reponse" : "prospection",
    subjectReviewed: !review.needsReview,
  });
  const dirty = subject !== (item.subject ?? "") || body !== item.body;

  function save() {
    startTransition(async () => {
      const result = await editScheduledMail(item.id, subject, body);
      if (!result.ok) return void toast.error([result.error, ...(result.errors ?? [])].join(" "));
      toast.success(result.rescheduled ? "Texte corrigé : le mail est de nouveau programmé." : "Texte enregistré.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <SubjectField
        id={`sched-subject-${item.id}`}
        value={subject}
        body={body}
        needsReview={review.needsReview}
        prospectId={item.prospectId}
        onChange={(next) => {
          setSubject(next);
          review.markReviewed();
        }}
        onConfirm={review.markReviewed}
      />
      <div>
        <Label htmlFor={`sched-body-${item.id}`}>Texte</Label>
        <Textarea id={`sched-body-${item.id}`} value={body} rows={10} onChange={(event) => setBody(event.target.value)} />
      </div>
      <PreflightPanel
        result={check.result}
        loading={check.loading}
        onFix={(fix) => {
          const next = applyFix(fix, { subject, body });
          setSubject(next.subject);
          setBody(next.body);
        }}
      />
      <div>
        <Button size="sm" onClick={save} loading={pending} disabled={!dirty && item.sendStatus !== "blocked"}>
          <Save className="h-3.5 w-3.5" aria-hidden /> Enregistrer le texte
        </Button>
      </div>
    </div>
  );
}
