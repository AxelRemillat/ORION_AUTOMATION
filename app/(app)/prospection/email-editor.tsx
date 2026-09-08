"use client";

import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, Input, Label, Textarea } from "@/components/ui";

/** Consigne de rédaction : au-delà, l'email perd son efficacité en cold email. */
const MAX_WORDS = 120;

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Mode SEMI-AUTO : le brouillon généré est éditable. Rien n'est enregistré
 * tant que l'utilisateur n'a pas validé.
 */
export function EmailEditor({
  subject,
  body,
  saving,
  regenerating,
  onChange,
  onValidate,
  onRegenerate,
}: {
  subject: string;
  body: string;
  saving: boolean;
  regenerating: boolean;
  onChange: (draft: { subject: string; body: string }) => void;
  onValidate: () => void;
  onRegenerate: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const words = countWords(body);
  const tooLong = words > MAX_WORDS;

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
            <span className={`text-xs tabular-nums ${tooLong ? "text-warning" : "text-muted"}`}>
              {words} mot{words > 1 ? "s" : ""} / {MAX_WORDS}
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
            <p className="mt-1.5 text-xs text-warning">
              Au-delà de {MAX_WORDS} mots, un email à froid est rarement lu jusqu&apos;au bout.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onValidate} loading={saving} disabled={!body.trim()}>
            <Check className="h-4 w-4" aria-hidden />
            Valider et enregistrer le brouillon
          </Button>
          <Button variant="secondary" onClick={onRegenerate} loading={regenerating}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Régénérer
          </Button>
          <span className="text-xs text-muted">
            {touched ? "Brouillon modifié." : "Relisez avant de valider."} L&apos;envoi reste manuel.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
