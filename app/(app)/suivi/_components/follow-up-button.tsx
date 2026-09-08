"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { MESSAGE_TYPE_LABELS } from "@/lib/constants";
import { generateFollowUp } from "../actions";

/** Génère une relance (OpenAI, repli sur un modèle) et l'enregistre en brouillon. */
export function FollowUpButton({
  prospectId,
  type,
  disabled,
}: {
  prospectId: string;
  type: "relance_1" | "relance_2";
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const generate = () =>
    startTransition(async () => {
      const result = await generateFollowUp(prospectId, type);
      if (result.ok) {
        toast.success(result.message ?? "Relance enregistrée.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <Button variant="secondary" size="sm" onClick={generate} loading={pending} disabled={disabled}>
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      Générer {MESSAGE_TYPE_LABELS[type].toLowerCase()}
    </Button>
  );
}
