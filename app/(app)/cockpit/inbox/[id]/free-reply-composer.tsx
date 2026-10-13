"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Send, Sparkles } from "lucide-react";
import { Button, Card, CardContent, Input, Label, Textarea, useToast } from "@/components/ui";
import { postJson } from "@/lib/enrichment/api-client";
import { sendReplyWithoutProspect } from "@/lib/outbox/actions";

/**
 * Réponse à un mail reçu SANS fiche (Cowork #51) : destinataire = l'expéditeur,
 * objet « Re: … », envoi dans le même fil Gmail. La réponse assistée s'appuie
 * seulement sur le mail reçu et le fil — aucune fiche inventée. Rien ne part
 * sans le clic « Envoyer » ; « ne plus contacter » est vérifié au départ.
 */
export const reSubject = (subject: string | null) => {
  const base = (subject ?? "").trim();
  return /^re\s*:/i.test(base) ? base : `Re: ${base}`.trim();
};

export function FreeReplyComposer({
  inboundId,
  defaultTo,
  subject: original,
  onHandled,
  marking,
}: {
  inboundId: string;
  defaultTo: string;
  subject: string | null;
  onHandled: () => void;
  marking: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(reSubject(original));
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  async function propose() {
    setDrafting(true);
    try {
      const data = await postJson<{ subject: string; body: string }>("/api/emails/reply", { inboundId });
      setBody(data.body);
      if (data.subject) setSubject(reSubject(data.subject));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Génération impossible.");
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    setSending(true);
    const result = await sendReplyWithoutProspect(inboundId, to, subject, body);
    if (!result.ok) {
      toast.error(result.error);
      return setSending(false);
    }
    toast.success("Réponse envoyée dans le même fil.");
    router.push("/cockpit");
    router.refresh();
  }

  const ready = Boolean(body.trim() && to.trim());
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-text">Votre réponse</h2>
            <p className="text-[12px] text-muted">Expéditeur sans fiche : la réponse part dans le même fil, depuis votre adresse.</p>
          </div>
          <Button size="sm" variant="secondary" loading={drafting} onClick={propose}>
            <Sparkles className="h-4 w-4" aria-hidden />
            {body ? "Regénérer" : "Proposer un brouillon"}
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="libre-destinataire">Destinataire</Label>
            <Input id="libre-destinataire" type="email" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="libre-objet">Objet</Label>
            <Input id="libre-objet" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="libre-corps">Message</Label>
          <Textarea id="libre-corps" value={body} rows={10} className="min-h-[200px]" placeholder="Rédigez votre réponse, ou demandez un brouillon." onChange={(event) => setBody(event.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button loading={sending} disabled={!ready} onClick={send}>
            <Send className="h-4 w-4" aria-hidden />
            Envoyer
          </Button>
          <Button variant="ghost" loading={marking} onClick={onHandled}>
            <Check className="h-4 w-4" aria-hidden />
            Traité sans répondre
          </Button>
          <span className="text-xs text-muted">Rien ne part tant que vous n&apos;avez pas cliqué « Envoyer ».</span>
        </div>
      </CardContent>
    </Card>
  );
}
