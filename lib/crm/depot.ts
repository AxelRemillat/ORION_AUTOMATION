/**
 * CRM — accès aux données. Deux implémentations du même contrat :
 *  - Supabase (production), sous la RLS : le client de la session ne voit que les lignes d'Axel ;
 *  - mémoire (mode démo local, lib/demo.ts), pour les captures et les tests Playwright.
 *
 * Rien n'est supprimé : `archiver` pose `archivee_le` (la fiche est masquée, pas effacée).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { modeDemo } from "@/lib/demo";
import { depotMemoire } from "./memoire";
import { OFFRES_INITIALES, type Commerce, type Evenement, type Offre, type TypeEvenement } from "./types";

export interface NouvelEvenement {
  type: TypeEvenement;
  contenu?: string | null;
  survenu_le?: string;
  meta?: Record<string, unknown>;
}

export interface DepotCrm {
  commerces(options?: { archives?: boolean }): Promise<Commerce[]>;
  commerce(id: string): Promise<Commerce | null>;
  creer(valeurs: Partial<Commerce> & { nom: string }): Promise<Commerce>;
  modifier(id: string, valeurs: Partial<Commerce>): Promise<Commerce>;
  evenements(commerceId: string): Promise<Evenement[]>;
  ajouterEvenement(commerceId: string, e: NouvelEvenement): Promise<Evenement>;
  offres(): Promise<Offre[]>;
}

type Loose = SupabaseClient<any, "public", any>;

const COLONNES = "*";

/** Erreur lisible, sans fuite de détail technique vers l'interface. */
function verifier<T>(res: { data: T | null; error: { message: string } | null }, quoi: string): T {
  if (res.error) throw new Error(`CRM : ${quoi} impossible (${res.error.message})`);
  if (res.data === null) throw new Error(`CRM : ${quoi} — aucune donnée`);
  return res.data;
}

export function depotSupabase(db: unknown): DepotCrm {
  const sb = db as Loose;
  return {
    async commerces({ archives = false } = {}) {
      let q = sb.from("crm_commerces").select(COLONNES).order("updated_at", { ascending: false }).range(0, 1999);
      if (!archives) q = q.is("archivee_le", null);
      return verifier(await q, "lecture des fiches") as Commerce[];
    },
    async commerce(id) {
      const { data, error } = await sb.from("crm_commerces").select(COLONNES).eq("id", id).maybeSingle();
      if (error) throw new Error(`CRM : lecture de la fiche impossible (${error.message})`);
      return (data as Commerce | null) ?? null;
    },
    async creer(valeurs) {
      return verifier(await sb.from("crm_commerces").insert(valeurs).select(COLONNES).single(), "création de la fiche") as Commerce;
    },
    async modifier(id, valeurs) {
      return verifier(await sb.from("crm_commerces").update(valeurs).eq("id", id).select(COLONNES).single(), "mise à jour de la fiche") as Commerce;
    },
    async evenements(commerceId) {
      const q = sb.from("crm_evenements").select("*").eq("commerce_id", commerceId).order("survenu_le", { ascending: false }).order("created_at", { ascending: false }).range(0, 499);
      return verifier(await q, "lecture de la chronologie") as Evenement[];
    },
    async ajouterEvenement(commerceId, e) {
      const ligne = { commerce_id: commerceId, type: e.type, contenu: e.contenu ?? null, meta: e.meta ?? {}, ...(e.survenu_le ? { survenu_le: e.survenu_le } : {}) };
      return verifier(await sb.from("crm_evenements").insert(ligne).select("*").single(), "ajout à la chronologie") as Evenement;
    },
    async offres() {
      const res = await sb.from("crm_offres").select("*").order("ordre").range(0, 199);
      const liste = verifier(res, "lecture des offres") as Offre[];
      if (liste.length) return liste;
      // Première lecture : la liste paramétrable est créée avec les offres du site (modifiables ensuite).
      const init = OFFRES_INITIALES.map((o, i) => ({ ...o, ordre: i }));
      return verifier(await sb.from("crm_offres").insert(init).select("*"), "création des offres") as Offre[];
    },
  };
}

/** Le dépôt de la requête : mémoire en mode démo local, Supabase sinon. */
export async function depotCrm(): Promise<DepotCrm> {
  if (modeDemo()) return depotMemoire();
  const { createClient } = await import("@/lib/supabase/server");
  return depotSupabase(createClient());
}
