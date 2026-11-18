// Choix du dépôt compta pour une requête, et vues calculées partagées par les écrans.
// Mode démo : COMPTA_DEMO=1 ET hors production (next dev) — données fictives en mémoire, pour les captures et les essais.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { echeanceFacture, resteDu, statutPaiement } from "./calculs";
import type { DepotCompta } from "./depot";
import { depotMemoire, type EtatMemoire } from "./depot-memoire";
import { depotSupabase } from "./depot-supabase";
import { AUJOURDHUI_DEMO, etatDemo } from "./fixtures";
import type { Facture, StatutPaiement } from "./types";

export const modeDemo = (): boolean => process.env.COMPTA_DEMO === "1" && process.env.NODE_ENV !== "production";

// Un seul état de démo pour tout le serveur de dev (Next charge ce module dans plusieurs bundles).
const globale = globalThis as typeof globalThis & { __comptaDemo?: Promise<EtatMemoire> };

/** Date du jour (Paris) ; figée au 18/11/2026 en démo, pour des captures stables. */
export const aujourdhui = (): string => (modeDemo() ? AUJOURDHUI_DEMO : new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }));

export async function depot(): Promise<DepotCompta> {
  if (modeDemo()) return depotMemoire(await (globale.__comptaDemo ??= etatDemo()), aujourdhui);
  return depotSupabase(createClient() as unknown as SupabaseClient);
}

export type FactureVue = Facture & { statut: StatutPaiement; reste: number; echeance: string | null; client_nom: string };

/** Tout ce qu'il faut aux écrans, chargé en parallèle, statuts de paiement calculés. */
export async function chargerTout(d: DepotCompta) {
  const [parametres, clients, devis, factures, encaissements, depenses, declarations] = await Promise.all([
    d.parametres(),
    d.clients(),
    d.devis(),
    d.factures(),
    d.encaissements(),
    d.depenses(),
    d.declarations(),
  ]);
  const jour = aujourdhui();
  const nomClient = (id: string) => clients.find((c) => c.id === id)?.nom ?? "—";
  const vues: FactureVue[] = factures.map((f) => ({
    ...f,
    statut: statutPaiement(f, factures, encaissements, jour),
    reste: f.type === "facture" && f.etat === "emise" ? resteDu(f, factures, encaissements) : 0,
    echeance: f.type === "facture" ? echeanceFacture(f) : null,
    client_nom: f.client?.nom ?? nomClient(f.client_id),
  }));
  return { parametres, clients, devis, factures: vues, encaissements, depenses, declarations, jour, nomClient };
}
