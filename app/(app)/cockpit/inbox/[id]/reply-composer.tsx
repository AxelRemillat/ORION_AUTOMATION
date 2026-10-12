"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Send, Sparkles } from "lucide-react";
import { Button, Card, CardContent, Input, Label, Textarea, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { postJson } from "@/lib/enrichment/api-client";
import { saveReply } from "@/lib/outbox/actions";
import type { ReplyDraft } from "@/lib/outbox/reply-draft";
import { MailActions } from "@/components/outbox/mail-actions";
import { MailTrashButton } from "@/components/outbox/mail-trash-button";
import { ScheduleDialog } from "@/components/outbox/schedule-dialog";

/**
 * Composeur de réponse — mode SEMI-AUTO : l'IA propose, l'utilisateur relit,
 * et RIEN ne part sans un clic. La réponse est enregistrée comme brouillon
 * rattaché au mail reçu (même fil Gmail) : on peut l'envoyer tout de suite, la
 * programmer, la mettre à la corbeille, ou la retrouver plus tard.
 */
export function ReplyComposer({
  inboundId,
  prospectId,
  defaultTo,
  draft,
}: {
  inboundId: string;
  /** `null` quand l'expéditeur ne correspond à aucun prospect connu. */
  prospectId: string | null;
  defaultTo: string;
  /** Brouillon de réponse déjà enregistré (non envoyé), s'il y en a un. */
  draft: ReplyDraft | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [to, setTo] = useState(draft?.scheduled_to ?? defaultTo);
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [marking, setMarking] = useState(false);
  const scheduled = draft?.send_status === "scheduled" || draft?.send_status === "sending";

  async function propose() {
    setDrafting(true);
    try {
      const data = await postJson<{ subject: string; body: string }>("/api/emails/reply", { inboundId });
      setSubject(data.subject);
      setBody(data.body);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Génération impossible.");
    } finally {
      setDrafting(false);
    }
  }

  /** Clôt l'entrant sans répondre — utile pour un refus ou un message traité ailleurs. */
  async function markHandled() {
    setMarking(true);
    // Traité à la main : c'est aussi lu (le badge « non lus » ne doit pas le garder).
    const { error } = await createClient()
      .from("inbound_messages")
      .update({ handled: true, read_at: new Date().toISOString() })
      .eq("id", inboundId);
    if (error) {
      toast.error(error.message);
      return setMarking(false);
    }
    toast.success("Message classé comme traité.");
    router.push("/cockpit");
    router.refresh();
  }

  const save = () => saveReply(inboundId, subject, body);

  async function send() {
    setSending(true);
    try {
      // Le brouillon (rattaché au fil) part par le pipeline d'envoi commun, qui
      // solde aussi le mail reçu.
      const saved = await save();
      if (!saved.ok) throw new Error(saved.error);
      await postJson("/api/emails/send", { to: to.trim(), prospect_id: prospectId, message_id: saved.messageId });
      toast.success("Réponse envoyée. Le prospect passe en discussion.");
      router.push("/cockpit");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Envoi impossible.");
      setSending(false);
    }
  }

  if (!prospectId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-5">
          <p className="text-[13px] leading-relaxed text-muted">
            Cette adresse ne correspond à aucun prospect enregistré. La réponse assistée s&apos;appuie sur la fiche
            entreprise et l&apos;historique : ajoutez d&apos;abord le contact depuis la Recherche, ou répondez
            directement depuis votre messagerie.
          </p>
          <Button variant="secondary" loading={marking} onClick={markHandled}>
            <Check className="h-4 w-4" aria-hidden />
            Marquer comme traité
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (draft && scheduled) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-5">
          <h2 className="text-[15px] font-semibold tracking-tight text-text">Réponse programmée</h2>
          {draft.subject && <p className="text-sm font-medium text-text">{draft.subject}</p>}
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{draft.body}</p>
          <MailActions
            state={{
              messageId: draft.id,
              sendStatus: draft.send_status,
              scheduledAt: draft.scheduled_at,
              scheduledTo: draft.scheduled_to,
              sendError: draft.send_error,
            }}
            defaultTo={defaultTo}
            label="la réponse"
          />
        </CardContent>
      </Card>
    );
  }

  const ready = Boolean(body.trim() && to.trim());
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-text">Votre réponse</h2>
          <Button size="sm" variant="secondary" loading={drafting} onClick={propose}>
            <Sparkles className="h-4 w-4" aria-hidden />
            {body ? "Regénérer" : "Proposer un brouillon"}
          </Button>
        </div>
        {draft?.send_error && <p className="text-[12px] text-lost-ink">{draft.send_error}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="destinataire">Destinataire</Label>
            <Input id="destinataire" type="email" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="objet">Objet</Label>
            <Input id="objet" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Re : …" />
          </div>
        </div>

        <div>
          <Label htmlFor="corps">Message</Label>
          <Textarea
            id="corps"
            value={body}
            rows={12}
            className="min-h-[240px]"
            placeholder="Rédigez votre réponse, ou demandez un brouillon."
            onChange={(event) => setBody(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button loading={sending} disabled={!ready} onClick={send}>
            <Send className="h-4 w-4" aria-hidden />
            Valider et envoyer
          </Button>
          <ScheduleDialog messageId={draft?.id ?? null} defaultTo={to} prepare={save} disabled={!ready} />
          <Button variant="ghost" loading={marking} onClick={markHandled}>
            <Check className="h-4 w-4" aria-hidden />
            Traité sans répondre
          </Button>
          {draft && (
            <MailTrashButton
              messageId={draft.id}
              label="le brouillon de réponse"
              onTrashed={() => {
                setSubject("");
                setBody("");
              }}
            />
          )}
          <span className="text-xs text-muted">Rien ne part tant que vous n&apos;avez pas validé.</span>
        </div>
      </CardContent>
    </Card>
  );
}
