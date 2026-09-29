"use client";

import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, Input, Label, Textarea } from "@/components/ui";
import { MAX_BODY_WORDS, bodyWordCount } from "@/lib/emails/word-count";

/**
 * Mode SEMI-AUTO : le brouillon généré est éditable. Rien n'est enregistré
 * tant que l'utilisateur n'a pas validé.
 */
export function EmailEditor({
  subject,
  body,
  signature,
  sendHint,
  saving,
  regenerating,
  onChange,
  onValidate,
  onRegenerate,
}: {
  subject: string;
  body: string;
  /** Signature construite depuis /offre : exclue du comptage, comme au serveur. */
  signature: string;
  /** Créneau conseillé pour ce secteur : indication, rien n'est programmé. */
  sendHint?: string | null;
  saving: boolean;
  regenerating: boolean;
  onChange: (draft: { subject: string; body: string }) => void;
  onValidate: () => void;
  onRegenerate: () => void;
}) {
  const [touched, setTouched] = useState(false);
  // Même comptage que le validateur : un mail refusé là-bas l'est ici aussi.
  const words = bodyWordCount(body, signature);
  const tooLong = words > MAX_BODY_WORDS;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div>
          <Label htmlFor="objet">Objet</Label>
          <Input
            id="objet"
            value={subject}
            onChange={(event) => {
              setTouched(true);
              onChange({ subject: event.target.value, body });
            }}
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <Label htmlFor="corps">Corps de l&apos;email</Label>
            <span className={`font-data text-xs ${tooLong ? "text-lost-ink" : "text-faint"}`}>
              {words} mot{words > 1 ? "s" : ""} / {MAX_BODY_WORDS} hors signature
            </span>
          </div>
          <Textarea
            id="corps"
            value={body}
            rows={12}
            className="min-h-[260px]"
            onChange={(event) => {
              setTouched(true);
              onChange({ subject, body: event.target.value });
            }}
          />
          {tooLong && (
            <p role="alert" className="mt-1.5 text-xs text-lost-ink">
              {words - MAX_BODY_WORDS} mot{words - MAX_BODY_WORDS > 1 ? "s" : ""} de trop : raccourcissez sous{" "}
              {MAX_BODY_WORDS} mots (signature non comprise) pour pouvoir valider.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onValidate} loading={saving} disabled={!body.trim() || tooLong}>
            <Check className="h-4 w-4" aria-hidden />
            Valider et enregistrer le brouillon
          </Button>
          <Button variant="secondary" onClick={onRegenerate} loading={regenerating}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Régénérer
          </Button>
          <span className="text-xs text-faint">
            {touched ? "Brouillon modifié." : "Relisez avant de valider."} L&apos;envoi reste manuel.
            {sendHint ? ` Créneau conseillé : ${sendHint}.` : ""}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
