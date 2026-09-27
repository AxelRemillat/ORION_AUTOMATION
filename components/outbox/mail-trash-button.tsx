"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { offerUndo } from "@/lib/trash/undo";
import { restoreMail, trashMail } from "@/lib/outbox/actions";

/**
 * « Mettre à la corbeille » pour un brouillon ou un mail programmé — même
 * geste que la corbeille des prospects : premier clic « Êtes-vous sûr ? »
 * pendant 4 s, second clic pour agir, puis toast « Annuler » de 8 s.
 */
export function MailTrashButton({
  messageId,
  label = "ce mail",
  onTrashed,
  className,
}: {
  messageId: string;
  /** Ce qui est nommé dans le toast (« le brouillon pour ACME »). */
  label?: string;
  onTrashed?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4_000);
    return () => clearTimeout(timer);
  }, [armed]);

  function click(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!armed) return setArmed(true);

    startTransition(async () => {
      const result = await trashMail(messageId);
      setArmed(false);
      if (!result.ok) return void toast.error(result.error);
      onTrashed?.();
      offerUndo(`${label.charAt(0).toUpperCase()}${label.slice(1)} mis à la corbeille`, async () => {
        const restored = await restoreMail(messageId);
        if (!restored.ok) toast.error(restored.error);
        router.refresh();
      });
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      aria-label={armed ? `Confirmer la mise à la corbeille de ${label}` : `Mettre ${label} à la corbeille`}
      title={armed ? "Cliquer à nouveau pour confirmer" : "Mettre à la corbeille"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50",
        armed
          ? "border-lost/40 bg-lost/10 text-lost-ink"
          : "border-line text-muted hover:bg-surface-2 hover:text-lost-ink",
        className,
      )}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
      {armed ? "Êtes-vous sûr ?" : "Mettre à la corbeille"}
    </button>
  );
}
