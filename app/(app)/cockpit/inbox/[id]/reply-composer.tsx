"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Send, Sparkles } from "lucide-react";
import { Button, Card, CardContent, Input, Label, Textarea, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { postJson } from "@/lib/enrichment/api-client";

/**
 * Composeur de réponse — mode SEMI-AUTO, comme le reste de l'app.
 *
 * L'IA propose, l'utilisateur relit et corrige, et RIEN ne part sans un clic
 * explicite sur « Valider et envoyer ». L'envoi réel passe par le pipeline n8n
 * existant (`/api/emails/send`), en transportant le `thread_id` pour que la
 * réponse atterrisse dans la conversation Gmail d'origine.
 */
export function ReplyComposer({
  inboundId,
  prospectId,
  threadId,
  defaultTo,
}: {
  inboundId: string;
  /** `null` quand l'expéditeur ne correspond à aucun prospect connu. */
  prospectId: string | null;
  threadId: string | null;
  defaultTo: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [marking, setMarking] = useState(false);

  async function draft() {
    setDrafting(true);
    try {
      const data = await postJson<{ subject: string; body: string }>("/api/emails/reply", {
        inboundId,
      });
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
    try {
      const { error } = await createClient()
        .from("inbound_messages")
        .update({ handled: true })
        .eq("id", inboundId);
      if (error) throw new Error(error.message);
      toast.success("Message classé comme traité.");
      router.push("/cockpit");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Impossible de classer le message.");
      setMarking(false);
    }
  }

  async function send() {
    if (!prospectId) return;
    setSending(true);
    const supabase = createClient();
    try {
      // 1. Le brouillon relu devient un message en base…
      const { data: message, error } = await supabase
        .from("messages")
        .insert({
          prospect_id: prospectId,
          type: "reponse",
          subject: subject.trim() || null,
          body: body.trim(),
          status: "draft",
          thread_id: threadId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      // 2. …puis part par le pipeline d'envoi existant.
      await postJson("/api/emails/send", {
        to: to.trim(),
        prospect_id: prospectId,
        message_id: message.id,
      });

      // 3. L'entrant est soldé seulement une fois le mail parti.
      await supabase.from("inbound_messages").update({ handled: true }).eq("id", inboundId);

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
            Cette adresse ne correspond à aucun prospect enregistré. La réponse assistée
            s&apos;appuie sur la fiche entreprise et l&apos;historique : ajoutez d&apos;abord le
            contact depuis la Recherche, ou répondez directement depuis votre messagerie.
          </p>
          <Button variant="secondary" loading={marking} onClick={markHandled}>
            <Check className="h-4 w-4" aria-hidden />
            Marquer comme traité
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-text">Votre réponse</h2>
          <Button size="sm" variant="secondary" loading={drafting} onClick={draft}>
            <Sparkles className="h-4 w-4" aria-hidden />
            {body ? "Regénérer" : "Proposer un brouillon"}
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="destinataire">Destinataire</Label>
            <Input
              id="destinataire"
              type="email"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="objet">Objet</Label>
            <Input
              id="objet"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Re : …"
            />
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
          <Button loading={sending} disabled={!body.trim() || !to.trim()} onClick={send}>
            <Send className="h-4 w-4" aria-hidden />
            Valider et envoyer
          </Button>
          <Button variant="ghost" loading={marking} onClick={markHandled}>
            <Check className="h-4 w-4" aria-hidden />
            Traité sans répondre
          </Button>
          <span className="text-xs text-muted">
            Rien ne part tant que vous n&apos;avez pas validé.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
