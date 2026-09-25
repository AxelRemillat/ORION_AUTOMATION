"use client";

import { useEffect, useState } from "react";
import { Trash2, Undo2 } from "lucide-react";
import { subscribeUndo, UNDO_WINDOW_MS, type UndoOffer } from "@/lib/trash/undo";

/**
 * Toast « Annuler » des mises à la corbeille, affiché 8 s.
 *
 * Distinct du ToastProvider du design system, qui n'a ni bouton ni durée
 * réglable : on ne touche pas à components/ui (CONTRACT.md).
 */
export function UndoHost() {
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeUndo(setOffer), []);

  useEffect(() => {
    if (!offer) return;
    const timer = setTimeout(() => setOffer((current) => (current?.id === offer.id ? null : current)), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [offer]);

  if (!offer) return null;

  async function undo() {
    if (!offer) return;
    setBusy(true);
    try {
      await offer.onUndo();
    } finally {
      setBusy(false);
      setOffer(null);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 overflow-hidden rounded-xl border border-line bg-elev p-3 shadow-overlay animate-slide-up"
    >
      <Trash2 className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-[13px] text-text">{offer.message}</p>
      <button
        type="button"
        onClick={undo}
        disabled={busy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
      >
        <Undo2 className="h-3.5 w-3.5" aria-hidden />
        Annuler
      </button>
      <Countdown key={offer.id} />
    </div>
  );
}

/** Barre qui se vide en 8 s : transition CSS, aucune keyframe à déclarer. */
function Countdown() {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setStarted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <span
      aria-hidden
      className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary/60 motion-reduce:hidden"
      style={{
        transform: started ? "scaleX(0)" : "scaleX(1)",
        transition: `transform ${UNDO_WINDOW_MS}ms linear`,
      }}
    />
  );
}
