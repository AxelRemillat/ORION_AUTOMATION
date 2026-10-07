import { AsyncLocalStorage } from "node:async_hooks";
import { registerLinkupRunReader, type LinkupRunContext } from "./gate";

/**
 * Contexte Linkup d'un job (SERVEUR SEULEMENT) : plafond de recherches du job
 * et segment (pour la part réservée `LINKUP_RESERVE`). Voir lib/linkup/gate.ts.
 */
const store = new AsyncLocalStorage<LinkupRunContext>();
registerLinkupRunReader(() => store.getStore());

export function withLinkupRun<T>(context: { cap?: number | null; segment?: string | null; since: Date }, run: () => Promise<T>): Promise<T> {
  const active = (typeof context.cap === "number" && context.cap >= 0) || Boolean(context.segment);
  return active ? store.run(context, run) : run();
}
