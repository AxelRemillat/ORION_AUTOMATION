"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Badge, Button, useToast } from "@/components/ui";
import { undoProspectRefusal } from "@/lib/outbox/actions";

/**
 * Badge « Refus » d'une fiche passée en Perdu par une réponse (Cowork #51),
 * avec « Annuler (pas un refus) » : statut d'avant, catégorie du mail et
 * « ne plus contacter » d'avant remis.
 */
export function RefusalControls({ prospectId, kind }: { prospectId: string; kind: "refus" | "stop" }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function undo() {
    startTransition(async () => {
      const result = await undoProspectRefusal(prospectId);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Ce n'était pas un refus : la fiche retrouve son statut.");
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge tone="danger">{kind === "stop" ? "Refus (stop)" : "Refus"}</Badge>
      <Button size="sm" variant="ghost" loading={pending} onClick={undo}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Annuler (pas un refus)
      </Button>
    </span>
  );
}
