"use client";

import { useState } from "react";
import { Check, Copy, PenLine } from "lucide-react";
import { Button, Label, Textarea, useToast } from "@/components/ui";
import { daysSinceSent } from "@/lib/opportunities/follow-up-due";
import type { Opportunity } from "@/lib/opportunities/types";

/**
 * « Relance à envoyer » : proposition « Envoyée » restée sans réponse (3 jours
 * sur Codeur, Malt, ComeUp ; 5 sur Upwork). Texte court rédigé par ORION, à
 * copier ; « Marquer relancée » la retire. Rien n'est envoyé automatiquement.
 */
export function FollowUpBox({ item, onPatched }: { item: Opportunity; onPatched: (patch: Partial<Opportunity>) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"write" | "done" | null>(null);
  const text = item.follow_up_text ?? "";
  const days = daysSinceSent(item);

  async function write() {
    setBusy("write");
    try {
      const response = await fetch(`/api/opportunites/${item.id}/relance`, { method: "POST" });
      const result = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !result.text) return toast.error(result.error ?? "Relance non rédigée.");
      onPatched({ follow_up_text: result.text });
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Relance copiée : collez-la dans la messagerie de la plateforme.");
    } catch {
      toast.error("Copie impossible : sélectionnez le texte à la main.");
    }
  }

  async function markDone() {
    setBusy("done");
    try {
      const response = await fetch(`/api/opportunites/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ followed_up: true }) });
      const result = (await response.json()) as { patch?: Partial<Opportunity>; error?: string };
      if (!response.ok || !result.patch) return toast.error(result.error ?? "Non enregistré.");
      onPatched(result.patch);
      toast.success("Marquée relancée.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-warn/25 bg-warn/5 p-3">
      <Label>Relance à envoyer</Label>
      <p className="mb-1.5 text-[12px] text-muted">Proposition envoyée il y a {days ?? "?"} jours, sans réponse. Une relance courte, à copier sur la plateforme : rien n&apos;est envoyé automatiquement.</p>
      {text ? (
        <>
          <Textarea readOnly rows={4} value={text} />
          <p className="mt-1 font-data text-[11px] text-faint">{text.length} / 400 caractères</p>
        </>
      ) : (
        <Button size="sm" variant="outline" loading={busy === "write"} onClick={write}>
          <PenLine className="h-3.5 w-3.5" aria-hidden /> Rédiger la relance
        </Button>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {text && (
          <Button size="sm" onClick={copy}>
            <Copy className="h-3.5 w-3.5" aria-hidden /> Copier
          </Button>
        )}
        <Button size="sm" variant="secondary" loading={busy === "done"} onClick={markDone}>
          <Check className="h-3.5 w-3.5" aria-hidden /> Marquer relancée
        </Button>
        {text && (
          <Button size="sm" variant="ghost" loading={busy === "write"} onClick={write}>
            <PenLine className="h-3.5 w-3.5" aria-hidden /> Réécrire
          </Button>
        )}
      </div>
    </div>
  );
}
