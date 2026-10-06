import { AsyncLocalStorage } from "node:async_hooks";
import { registerRunCapReader, type RunCap } from "./gate";

/**
 * Plafond de crédits Hunter d'un LOT (serveur seulement) : les appels faits
 * sous `withHunterRunCap` sont bornés à `cap` crédits facturés depuis `since`,
 * en plus du budget du jour (lib/hunter/gate.ts).
 */
const store = new AsyncLocalStorage<RunCap>();
registerRunCapReader(() => store.getStore());

export function withHunterRunCap<T>(cap: number | null | undefined, since: Date, run: () => Promise<T>): Promise<T> {
  return typeof cap === "number" && cap >= 0 ? store.run({ cap, since }, run) : run();
}
