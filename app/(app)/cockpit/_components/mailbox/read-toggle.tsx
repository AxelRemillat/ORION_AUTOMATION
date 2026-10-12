"use client";

import { useEffect } from "react";
import { Mail, MailOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInboxRead } from "./read-state";

/** Un mail resté 2 s à l'écran a été lu : c'est le geste, pas un clic de plus. */
export const AUTO_READ_MS = 2000;

/**
 * « Marquer comme lu » / « Marquer non lu », sur chaque message reçu.
 *
 * Deux tailles : l'icône seule dans la liste (le 360 px tient), le bouton avec
 * son libellé dans le volet de lecture.
 */
export function ReadToggle({
  id,
  unread,
  variant = "icon",
  className,
}: {
  id: string;
  unread: boolean;
  variant?: "icon" | "labelled";
  className?: string;
}) {
  const state = useInboxRead();
  if (!state) return null;

  const isUnread = state.isUnread(id, unread);
  const label = isUnread ? "Marquer comme lu" : "Marquer non lu";
  const Icon = isUnread ? MailOpen : Mail;

  return (
    <button
      type="button"
      onClick={() => state.setRead(id, isUnread)}
      disabled={state.pendingId === id}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md text-muted motion-safe:transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50",
        variant === "icon" ? "h-7 w-7 justify-center" : "border border-line px-2.5 py-1 text-[13px] font-medium",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {variant === "labelled" && label}
    </button>
  );
}

/**
 * Marque lu le mail affiché après {@link AUTO_READ_MS} d'affichage continu.
 * Changer de message avant la fin annule : feuilleter la liste ne solde rien.
 */
export function useAutoRead(id: string | null, unread: boolean): void {
  const state = useInboxRead();

  useEffect(() => {
    if (!state || !id || !state.isUnread(id, unread)) return;
    const timer = setTimeout(() => state.setRead(id, true), AUTO_READ_MS);
    return () => clearTimeout(timer);
    // `state` change à chaque frappe du compteur : seul le mail affiché doit relancer le délai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unread]);
}
