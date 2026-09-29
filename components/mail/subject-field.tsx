"use client";

import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Badge, Button, Input, Label, useToast } from "@/components/ui";
import { normalizeSubject, SUBJECT_MAX } from "@/lib/mail-preflight";

/**
 * Objet du mail. Quand le corps a changé (édition ou régénération) sans que
 * l'objet ait été relu, il est marqué « à revoir » jusqu'à ce qu'on le touche
 * ou qu'on le confirme. « Proposer un objet » : 1 appel au modèle bon marché.
 */
export function SubjectField({
  id,
  value,
  body,
  needsReview,
  prospectId,
  onChange,
  onConfirm,
}: {
  id: string;
  value: string;
  body: string;
  needsReview: boolean;
  prospectId?: string | null;
  onChange: (subject: string) => void;
  onConfirm: () => void;
}) {
  const toast = useToast();
  const [proposing, setProposing] = useState(false);

  async function propose() {
    setProposing(true);
    try {
      const response = await fetch("/api/mail-preflight/subject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, prospectId }),
      });
      const payload = (await response.json()) as { subject?: string; error?: string };
      if (!response.ok || !payload.subject) throw new Error(payload.error ?? "Aucun objet proposé.");
      onChange(payload.subject);
      toast.success("Objet proposé à partir du corps actuel.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Aucun objet proposé.");
    } finally {
      setProposing(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>Objet</Label>
        <div className="flex items-center gap-1">
          {needsReview && <Badge tone="warning">À revoir : le corps a changé</Badge>}
          {needsReview && (
            <Button size="sm" variant="ghost" onClick={onConfirm}>
              <Check className="h-3.5 w-3.5" aria-hidden /> Confirmer
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={propose} loading={proposing} disabled={!body.trim()}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Proposer un objet
          </Button>
        </div>
      </div>
      <Input
        id={id}
        value={value}
        maxLength={SUBJECT_MAX + 20}
        className={needsReview ? "border-warn bg-warn/10" : undefined}
        onChange={(event) => onChange(event.target.value)}
        // Majuscule initiale et point final corrigés dès qu'on quitte le champ.
        onBlur={(event) => {
          const fixed = normalizeSubject(event.target.value);
          if (fixed !== event.target.value) onChange(fixed);
        }}
      />
      <p className="mt-1 font-data text-[11px] text-faint">
        {value.length}/{SUBJECT_MAX}
      </p>
    </div>
  );
}
