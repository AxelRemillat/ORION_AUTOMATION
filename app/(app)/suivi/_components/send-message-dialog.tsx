"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button, Input, Label, Modal, Textarea, useToast } from "@/components/ui";

interface SendMessageDialogProps {
  prospectId: string;
  messageId: string;
  subject: string | null;
  body: string;
  /** Adresse pré-remplie (enrichissement ou domaine du site). */
  defaultTo: string;
}

/**
 * Envoi semi-automatique : on confirme le destinataire, l'API pousse vers le
 * webhook n8n (qui envoie via Gmail) puis met à jour message, statut et relance.
 */
export function SendMessageDialog({
  prospectId,
  messageId,
  subject,
  body,
  defaultTo,
}: SendMessageDialogProps) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body, prospect_id: prospectId, message_id: messageId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "L'envoi a échoué.");
        return;
      }
      toast.success(`Message envoyé à ${to}.`);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Réseau indisponible : réessayez dans un instant.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Send className="h-3.5 w-3.5" aria-hidden />
        Envoyer
      </Button>

      <Modal
        open={open}
        onClose={() => (sending ? undefined : setOpen(false))}
        title="Envoyer le message"
        description="Le mail part du compte Gmail via n8n. Vérifiez le destinataire avant d'envoyer."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
              Annuler
            </Button>
            <Button onClick={send} loading={sending} disabled={!to.trim()}>
              Envoyer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="send-to">Destinataire</Label>
            <Input
              id="send-to"
              type="email"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="prenom.nom@entreprise.fr"
              error={error ?? undefined}
            />
          </div>
          <div>
            <Label htmlFor="send-subject">Objet</Label>
            <Input id="send-subject" value={subject ?? ""} readOnly />
          </div>
          <div>
            <Label htmlFor="send-body">Message</Label>
            <Textarea id="send-body" value={body} readOnly className="min-h-[180px]" />
          </div>
        </div>
      </Modal>
    </>
  );
}
