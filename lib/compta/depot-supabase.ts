// Implémentation Supabase du dépôt compta : client de la session (RLS owner_id = auth.uid()), jamais la clé service.
// Les règles fortes sont dans la base (supabase/migrations/*_compta_init.sql) : numérotation à l'émission, facture émise
// immuable, total recalculé. Client non typé : les tables compta ne sont pas dans le type Database généré.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ErreurCompta, type DepotCompta } from "./depot";
import type { ClientCompta, Declaration, Depense, Devis, Encaissement, EntreeJournal, Facture, Parametres } from "./types";

const BUCKET = "compta-justificatifs";

function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new ErreurCompta(r.error.message.replace(/^.*?ERROR:\s*/, ""));
  return r.data as T;
}

export function depotSupabase(db: SupabaseClient): DepotCompta {
  const t = (nom: string) => db.from(nom);
  return {
    async parametres() {
      const p = ok(await t("compta_parametres").select("*").maybeSingle());
      return (p as Parametres | null) ?? null;
    },
    async enregistrerParametres(p) {
      ok(await t("compta_parametres").upsert({ ...p, updated_at: new Date().toISOString() }, { onConflict: "owner_id" }));
    },
    clients: async () => ok(await t("compta_clients").select("*").order("nom")) as ClientCompta[],
    creerClient: async (c) => (ok(await t("compta_clients").insert(c).select("id").single()) as { id: string }).id,
    devis: async () => ok(await t("compta_devis").select("*").order("created_at", { ascending: false })) as Devis[],
    creerDevis: async (d) => (ok(await t("compta_devis").insert(d).select("id").single()) as { id: string }).id,
    async modifierDevis(id, patch) {
      ok(await t("compta_devis").update(patch).eq("id", id));
    },
    devisVersFacture: async (id) => ok(await db.rpc("compta_devis_vers_facture", { p_devis: id })) as string,
    factures: async () => ok(await t("compta_factures").select("*").order("created_at", { ascending: false })) as Facture[],
    creerFacture: async (f) => (ok(await t("compta_factures").insert(f).select("id").single()) as { id: string }).id,
    async modifierBrouillon(id, patch) {
      ok(await t("compta_factures").update(patch).eq("id", id).eq("etat", "brouillon"));
    },
    async supprimerBrouillon(id) {
      ok(await t("compta_factures").delete().eq("id", id).eq("etat", "brouillon"));
    },
    emettre: async (id) => ok(await db.rpc("compta_emettre", { p_facture: id })) as Facture,
    async creerAvoir(factureId, lignes, motif) {
      const f = ok(await t("compta_factures").select("client_id, objet").eq("id", factureId).single()) as { client_id: string; objet: string };
      const ins = await t("compta_factures").insert({ type: "avoir", client_id: f.client_id, objet: `Avoir — ${f.objet}`, lignes, facture_origine_id: factureId, motif_avoir: motif, echeance_jours: 0 }).select("id").single();
      return (ok(ins) as { id: string }).id;
    },
    encaissements: async () => ok(await t("compta_encaissements").select("*").order("date")) as Encaissement[],
    creerEncaissement: async (e) => (ok(await t("compta_encaissements").insert(e).select("id").single()) as { id: string }).id,
    depenses: async () => ok(await t("compta_depenses").select("*").order("date", { ascending: false })) as Depense[],
    async creerDepense(d, justificatif) {
      let chemin: string | null = null;
      if (justificatif) {
        const { data } = await db.auth.getUser();
        if (!data.user) throw new ErreurCompta("Session expirée");
        chemin = `${data.user.id}/${Date.now()}-${justificatif.nom.replace(/[^\w.-]+/g, "_")}`;
        const r = await db.storage.from(BUCKET).upload(chemin, justificatif.octets, { contentType: justificatif.type, upsert: false });
        if (r.error) throw new ErreurCompta(`Justificatif non téléversé : ${r.error.message}`);
      }
      return (ok(await t("compta_depenses").insert({ ...d, justificatif_chemin: chemin }).select("id").single()) as { id: string }).id;
    },
    async lienJustificatif(chemin) {
      const r = await db.storage.from(BUCKET).createSignedUrl(chemin, 300);
      return r.data?.signedUrl ?? null;
    },
    declarations: async () => ok(await t("compta_declarations").select("*").order("annee").order("trimestre")) as Declaration[],
    async marquerDeclare(annee, trimestre, montant) {
      ok(await t("compta_declarations").upsert({ annee, trimestre, montant_declare: montant }, { onConflict: "owner_id,annee,trimestre" }));
    },
    journal: async (objetId) => ok(await t("compta_journal").select("*").eq("objet_id", objetId).order("quand")) as EntreeJournal[],
  };
}
