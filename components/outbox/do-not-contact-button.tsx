"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, RotateCcw } from "lucide-react";
import { Button, Modal, useToast } from "@/components/ui";
import { setProspectDoNotContact } from "@/lib/outbox/actions";

/**
 * « Ne plus contacter » — avec confirmation. Bloque tout envoi, annule les
 * envois programmés, passe le prospect en « perdu ». Réversible : le même
 * bouton, sur la fiche, lève le blocage et rend le statut d'avant.
 */
export function DoNotContactButton({
  prospectId,
  companyName,
  active,
  size = "sm",
}: {
  prospectId: string;
  companyName: string;
  /** Le prospect est déjà marqué « ne plus contacter ». */
  active: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply(on: boolean) {
    startTransition(async () => {
      const result = await setProspectDoNotContact(prospectId, on);
      if (!result.ok) return void toast.error(result.error);
      toast.success(
        on
          ? `${companyName} : plus aucun envoi.${result.cancelled ? ` ${result.cancelled} envoi(s) programmé(s) annulé(s).` : ""}`
          : `${companyName} peut de nouveau être contacté.`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  if (active) {
    return (
      <Button size={size} variant="outline" loading={pending} onClick={() => apply(false)}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Autoriser à nouveau
      </Button>
    );
  }

  return (
    <>
      <Button size={size} variant="ghost" onClick={() => setOpen(true)}>
        <Ban className="h-3.5 w-3.5" aria-hidden />
        Ne plus contacter
      </Button>
      <Modal
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        title={`Ne plus contacter ${companyName} ?`}
        description="Plus aucun mail ne partira vers ce prospect, les envois programmés sont annulés et il passe en « Perdu ». Réversible depuis sa fiche."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button variant="danger" loading={pending} onClick={() => apply(true)}>
              Ne plus contacter
            </Button>
          </>
        }
      />
    </>
  );
}
