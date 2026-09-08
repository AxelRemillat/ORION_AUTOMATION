"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Modal, useToast } from "@/components/ui";
import { createDeal } from "../actions";

/** Saisie du contrat signé : montant + date. Bascule aussi le prospect en « gagné ». */
export function DealModal({
  prospectId,
  open,
  onClose,
}: {
  prospectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [signedAt, setSignedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const submit = () => {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Indiquez un montant en euros.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createDeal(prospectId, value, signedAt);
      if (result.ok) {
        toast.success("Contrat enregistré. Prospect passé en « Gagné ».");
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enregistrer un contrat"
      description="Le prospect passera automatiquement en « Gagné » et le montant alimentera le dashboard."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button onClick={submit} loading={pending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="deal-amount">Montant (€)</Label>
          <Input
            id="deal-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="4500"
            error={error ?? undefined}
          />
        </div>
        <div>
          <Label htmlFor="deal-date">Date de signature</Label>
          <Input
            id="deal-date"
            type="date"
            value={signedAt}
            onChange={(event) => setSignedAt(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
