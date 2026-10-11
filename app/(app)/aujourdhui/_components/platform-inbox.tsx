"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, MessageSquare, RotateCcw } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, useToast } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import type { PlatformTask } from "@/lib/today/platform";

/**
 * Conversations de plateforme, en tête de la file (Cowork #17).
 *
 * Un bloc à part, et non des éléments de la file : ces tâches n'ont ni
 * destinataire ni brouillon ORION, et RIEN n'en part d'ici — Axel copie le
 * texte et répond sur Codeur. Elles ne touchent donc pas au plafond d'envoi,
 * et le reste de la page ne change pas d'un pixel.
 */
export function PlatformInbox({ tasks }: { tasks: PlatformTask[] }) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  if (tasks.length === 0) return null;

  const mark = (task: PlatformTask) =>
    startTransition(async () => {
      // « Marquer répondu » pose le statut « Entretien » (la conversation est
      // engagée) ; « Marquer relancée » pose seulement la date de relance.
      const body = task.kind === "message" ? { status: "entretien" } : { followed_up: true };
      const response = await fetch(`/api/opportunites/${task.opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        toast.success(task.kind === "message" ? "Marqué répondu." : "Marquée relancée.");
        router.refresh();
      } else {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(json?.error ?? "Enregistrement impossible.");
      }
    });

  const copy = async (task: PlatformTask) => {
    if (!task.text) return;
    try {
      await navigator.clipboard.writeText(task.text);
      setCopied(task.opportunityId);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copie refusée par le navigateur.");
    }
  };

  return (
    <Card className="mb-4 border-primary/35">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <MessageSquare className="h-4 w-4 text-primary" aria-hidden />
        <CardTitle>Conversations sur les plateformes</CardTitle>
        <Badge tone="accent" className="ml-1">
          {tasks.length}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-2">
        {tasks.map((task) => (
          <article key={`${task.kind}:${task.opportunityId}`} className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{task.platformLabel}</Badge>
              <Badge tone={task.kind === "message" ? "accent" : "warning"}>
                {task.kind === "message" ? "Message reçu" : `Relance due · ${task.days} j`}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{task.title}</span>
            </div>

            {task.sent && (
              <p className="mt-1 text-[12px] text-faint">
                Proposition envoyée le {formatDate(task.sent.at)}
                {task.sent.text ? ` · ${task.sent.text.length} caractères` : " · texte non enregistré"}
              </p>
            )}

            {task.kind === "message" && (
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted">
                {task.excerpt ?? "Message reçu — ouvrez la conversation sur la plateforme pour le lire."}
              </p>
            )}

            {task.text && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line-soft bg-surface p-2 text-[12px] text-text">
                {task.text}
              </pre>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {task.url && (
                <a href={task.url} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    Ouvrir sur {task.platformLabel}
                  </Button>
                </a>
              )}
              {task.text && (
                <Button variant="secondary" size="sm" onClick={() => copy(task)}>
                  {copied === task.opportunityId ? "Copié" : "Copier le texte"}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => mark(task)} disabled={pending} className="ml-auto">
                {task.kind === "message" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                {task.kind === "message" ? "Marquer répondu" : "Marquer relancée"}
              </Button>
            </div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
