/**
 * Offre d'annulation après une mise à la corbeille : un minuscule bus
 * d'événements côté client, écouté par <UndoHost /> (monté dans le layout).
 * Il survit donc à la navigation — utile quand la fiche prospect redirige
 * vers le Suivi juste après la suppression.
 */

export const UNDO_WINDOW_MS = 8_000;

export interface UndoOffer {
  id: number;
  message: string;
  onUndo: () => Promise<void>;
}

type Listener = (offer: UndoOffer) => void;

const listeners = new Set<Listener>();
let nextId = 0;

export function offerUndo(message: string, onUndo: () => Promise<void>): void {
  const offer = { id: nextId++, message, onUndo };
  listeners.forEach((listener) => listener(offer));
}

export function subscribeUndo(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
