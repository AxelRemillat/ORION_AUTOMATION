"use client";

import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, Label, Textarea, useToast } from "@/components/ui";
import { PreflightPanel } from "@/components/mail/preflight-panel";
import { SubjectField } from "@/components/mail/subject-field";
import { usePreflight } from "@/components/mail/use-preflight";
import { useSubjectReview } from "@/components/mail/use-subject-review";
import { applyFix, bodyWordCount, extractSubjectLine, MAX_BODY_WORDS } from "@/lib/mail-preflight";

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
  const toast = useToast();
  const review = useSubjectReview(body);
  // Validation : le destinataire se choisit à l'envoi, il n'est pas contrôlé ici.
  const check = usePreflight({ subject, body, checkRecipient: false, subjectReviewed: !review.needsReview });
  const blocked = Boolean(check.result && !check.result.ok);
  // Compté par le serveur (signature du compte retirée) ; en attendant, même
  // comptage local que le validateur : un mail refusé là-bas l'est ici aussi.
  const words = check.result?.words ?? bodyWordCount(body, signature);
  const tooLong = words > MAX_BODY_WORDS;

  /** Corps collé qui commence par « Objet : … » : la ligne part dans le champ objet. */
  function changeBody(next: string) {
    setTouched(true);
    const moved = extractSubjectLine(next);
    if (moved.subject) {
      onChange({ subject: moved.subject, body: moved.body });
      review.markReviewed();
      toast.toast("Objet déplacé : la ligne « Objet : » du corps est passée dans le champ objet.");
      return;
    }
    onChange({ subject, body: next });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <SubjectField
          id="objet"
          value={subject}
          body={body}
          needsReview={review.needsReview}
          onChange={(next) => {
            setTouched(true);
            review.markReviewed();
            onChange({ subject: next, body });
          }}
          onConfirm={review.markReviewed}
        />

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
            onChange={(event) => changeBody(event.target.value)}
          />
          {tooLong && (
            <p role="alert" className="mt-1.5 text-xs text-lost-ink">
              {words - MAX_BODY_WORDS} mot{words - MAX_BODY_WORDS > 1 ? "s" : ""} de trop : raccourcissez sous{" "}
              {MAX_BODY_WORDS} mots (signature non comprise) pour pouvoir valider.
            </p>
          )}
        </div>

        <PreflightPanel
          result={check.result}
          loading={check.loading}
          onFix={(fix) => onChange(applyFix(fix, { subject, body }, signature))}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={onValidate}
            loading={saving}
            disabled={!body.trim() || tooLong || blocked || check.loading}
          >
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
