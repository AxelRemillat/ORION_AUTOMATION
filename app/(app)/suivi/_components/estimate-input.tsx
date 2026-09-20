"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { Button, Input, useToast } from "@/components/ui";
import { formatEur } from "@/lib/utils";
import { setDealEstimate } from "../actions";

/**
 * Montant estimé de l'affaire, saisi à la main.
 *
 * C'est la seule source de la « valeur du pipeline » : tant que rien n'est
 * saisi, on affiche « — » plutôt qu'un chiffre reconstitué. Vider le champ
 * efface l'estimation.
 */
export function EstimateInput({
  prospectId,
  amount,
  editable = true,
}: {
  prospectId: string;
  amount: number | null;
  /** Un contrat signé fige le montant : plus d'édition en ligne. */
  editable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(amount == null ? "" : String(amount));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  if (!editable) {
    return <span className="font-data text-sm text-text">{formatEur(amount)}</span>;
  }

  const save = () => {
    const trimmed = draft.trim();
    const parsed = trimmed === "" ? null : Number(trimmed.replace(",", ".").replace(/\s/g, ""));
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError("Montant invalide.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setDealEstimate(prospectId, parsed);
      if (result.ok) {
        toast.success(result.message ?? "Estimation enregistrée.");
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-data text-sm text-text">{formatEur(amount)}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(amount == null ? "" : String(amount));
            setEditing(true);
          }}
          aria-label={amount == null ? "Saisir un montant estimé" : "Modifier le montant estimé"}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          {amount == null ? "Estimer" : "Modifier"}
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-start gap-1.5">
      <span className="w-32">
        <Input
          autoFocus
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") setEditing(false);
          }}
          placeholder="ex. 6000"
          aria-label="Montant estimé en euros"
          error={error ?? undefined}
          disabled={pending}
        />
      </span>
      <Button size="sm" onClick={save} loading={pending} aria-label="Enregistrer">
        <Check className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setEditing(false)}
        disabled={pending}
        aria-label="Annuler"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </span>
  );
}
