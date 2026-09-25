"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { offerUndo } from "@/lib/trash/undo";
import { restoreProspect, trashProspect } from "@/app/(app)/corbeille/actions";

/**
 * « Mettre à la corbeille », avec confirmation légère : le premier clic arme
 * le bouton (« Confirmer ? » pendant 4 s), le second agit. Suivi d'un toast
 * « Annuler » de 8 s qui restaure le prospect à l'identique.
 */
export function TrashButton({
  prospectId,
  companyName,
  variant = "icon",
  redirectTo,
  onTrashed,
  className,
}: {
  prospectId: string;
  companyName: string;
  /** `icon` dans les listes, `button` sur la fiche. */
  variant?: "icon" | "button";
  /** Page à rejoindre après coup (la fiche d'un prospect supprimé n'existe plus). */
  redirectTo?: string;
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
    // Dans une carte cliquable ou déplaçable, le clic ne doit rien déclencher d'autre.
    event.preventDefault();
    event.stopPropagation();
    if (!armed) return setArmed(true);

    startTransition(async () => {
      const result = await trashProspect(prospectId);
      setArmed(false);
      if (!result.ok) return void toast.error(result.error);

      onTrashed?.();
      offerUndo(`« ${companyName} » mis à la corbeille`, async () => {
        const restored = await restoreProspect(prospectId);
        if (!restored.ok) toast.error(restored.error);
        router.refresh();
      });
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  const label = armed ? `Confirmer la mise à la corbeille de ${companyName}` : `Mettre ${companyName} à la corbeille`;

  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      aria-label={label}
      title={armed ? "Cliquer à nouveau pour confirmer" : "Mettre à la corbeille"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50",
        variant === "icon" ? "p-1.5" : "border px-3 py-1.5",
        armed
          ? "border-lost/40 bg-lost/10 text-lost-ink"
          : "border-line text-muted hover:bg-surface-2 hover:text-lost-ink",
        className,
      )}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
      {(variant === "button" || armed) && (armed ? "Confirmer ?" : "Mettre à la corbeille")}
    </button>
  );
}
