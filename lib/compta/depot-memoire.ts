// Dépôt compta EN MÉMOIRE : mode démo local (COMPTA_DEMO=1, jamais en production) et tests. Reproduit les règles de la
// base : numéro attribué à l'émission sans trou, facture émise immuable, avoir plafonné, encaissement sur facture émise.
import { formatNumero, totalLignes } from "./calculs";
import { ErreurCompta, type DepotCompta } from "./depot";
import type { ClientCompta, Declaration, Depense, Devis, Encaissement, EntreeJournal, Facture, Parametres } from "./types";

export type EtatMemoire = {
  parametres: Parametres | null;
  clients: ClientCompta[];
  devis: Devis[];
  factures: Facture[];
  encaissements: Encaissement[];
  depenses: Depense[];
  declarations: Declaration[];
  journal: EntreeJournal[];
  compteurs: Record<string, number>;
  /** Prochain identifiant : déterministe (mêmes identifiants à chaque reconstruction de la démo). */
  suivant?: number;
};

export function depotMemoire(etat: EtatMemoire, aujourdhui: () => string): DepotCompta {
  const id = () => `demo-${(etat.suivant = (etat.suivant ?? 0) + 1)}`;
  const rang = (serie: "D" | "F" | "A", annee: number) => (etat.compteurs[`${serie}${annee}`] = (etat.compteurs[`${serie}${annee}`] ?? 0) + 1);
  const tracer = (objet: "devis" | "facture", objet_id: string, action: string, detail: string | null = null) =>
    etat.journal.push({ id: id(), quand: new Date().toISOString(), objet, objet_id, action, detail });
  const facture = (fid: string) => {
    const f = etat.factures.find((x) => x.id === fid);
    if (!f) throw new ErreurCompta("Facture introuvable");
    return f;
  };
  const brouillon = (fid: string) => {
    const f = facture(fid);
    if (f.etat === "emise") throw new ErreurCompta("Une facture émise n'est plus modifiable : émettez un avoir");
    return f;
  };
  return {
    parametres: async () => etat.parametres,
    enregistrerParametres: async (p) => void (etat.parametres = p),
    clients: async () => [...etat.clients].sort((a, b) => a.nom.localeCompare(b.nom)),
    creerClient: async (c) => (etat.clients.push({ ...c, id: id() }), etat.clients.at(-1)!.id),
    devis: async () => [...etat.devis].reverse(),
    async creerDevis(d) {
      const date = d.date ?? aujourdhui();
      const nouveau: Devis = { ...d, id: id(), date, numero: formatNumero("D", Number(date.slice(0, 4)), rang("D", Number(date.slice(0, 4)))), total: totalLignes(d.lignes), statut: "brouillon", facture_id: null };
      etat.devis.push(nouveau);
      tracer("devis", nouveau.id, "insert");
      return nouveau.id;
    },
    async modifierDevis(did, patch) {
      const d = etat.devis.find((x) => x.id === did);
      if (!d) throw new ErreurCompta("Devis introuvable");
      Object.assign(d, patch, patch.lignes ? { total: totalLignes(patch.lignes) } : {});
      tracer("devis", did, patch.statut ? `statut:${patch.statut}` : "update");
    },
    async devisVersFacture(did) {
      const d = etat.devis.find((x) => x.id === did);
      if (!d) throw new ErreurCompta("Devis introuvable");
      if (d.facture_id) return d.facture_id;
      const fid = await this.creerFacture({ client_id: d.client_id, objet: d.objet, lignes: d.lignes, date_prestation: "", echeance_jours: 30 });
      facture(fid).devis_id = d.id;
      Object.assign(d, { facture_id: fid, statut: "accepte" });
      return fid;
    },
    factures: async () => [...etat.factures].reverse(),
    async creerFacture(f) {
      const nouvelle: Facture = { ...f, id: id(), type: "facture", numero: null, etat: "brouillon", date_emission: null, total: totalLignes(f.lignes), devis_id: null, facture_origine_id: null, motif_avoir: null, emetteur: null, client: null };
      etat.factures.push(nouvelle);
      tracer("facture", nouvelle.id, "insert");
      return nouvelle.id;
    },
    async modifierBrouillon(fid, patch) {
      const f = brouillon(fid);
      Object.assign(f, patch, patch.lignes ? { total: totalLignes(patch.lignes) } : {});
      tracer("facture", fid, "update");
    },
    async supprimerBrouillon(fid) {
      brouillon(fid);
      etat.factures = etat.factures.filter((x) => x.id !== fid);
      tracer("facture", fid, "delete");
    },
    async emettre(fid) {
      const f = brouillon(fid);
      const p = etat.parametres;
      if (!p || !p.nom.trim() || !p.adresse.trim() || !p.siret.trim()) throw new ErreurCompta("Renseignez le nom, l'adresse et le SIRET dans les paramètres avant d'émettre");
      if (!f.lignes.length || f.total <= 0) throw new ErreurCompta("Une facture sans ligne ou à 0 € ne s'émet pas");
      if (f.type === "avoir") {
        const origine = facture(f.facture_origine_id!);
        const deja = etat.factures.filter((a) => a.type === "avoir" && a.etat === "emise" && a.facture_origine_id === origine.id).reduce((s, a) => s + a.total, 0);
        if (f.total + deja > origine.total) throw new ErreurCompta("L'avoir dépasse le montant restant de la facture d'origine");
      }
      const c = etat.clients.find((x) => x.id === f.client_id)!;
      const date = aujourdhui();
      const annee = Number(date.slice(0, 4));
      const serie = f.type === "avoir" ? "A" : "F";
      Object.assign(f, {
        etat: "emise",
        date_emission: date,
        numero: formatNumero(serie, annee, rang(serie, annee)),
        emetteur: { nom: p.nom, adresse: p.adresse, siret: p.siret, email: p.email, telephone: p.telephone, iban: p.iban },
        client: { nom: c.nom, adresse: c.adresse, siren: c.siren, professionnel: c.professionnel, email: c.email },
      });
      tracer("facture", fid, "emission", f.numero);
      return f;
    },
    async creerAvoir(fid, lignes, motif) {
      const origine = facture(fid);
      const avoir: Facture = { ...origine, id: id(), type: "avoir", numero: null, etat: "brouillon", date_emission: null, objet: `Avoir — ${origine.objet}`, lignes, total: totalLignes(lignes), facture_origine_id: fid, motif_avoir: motif, echeance_jours: 0, devis_id: null, emetteur: null, client: null };
      etat.factures.push(avoir);
      tracer("facture", avoir.id, "insert");
      return avoir.id;
    },
    encaissements: async () => [...etat.encaissements],
    async creerEncaissement(e) {
      if (e.facture_id) {
        const f = facture(e.facture_id);
        if (f.etat !== "emise" || f.type !== "facture" || f.client_id !== e.client_id) throw new ErreurCompta("Un encaissement se rattache à une facture émise du même client");
      }
      etat.encaissements.push({ ...e, id: id() });
      return etat.encaissements.at(-1)!.id;
    },
    depenses: async () => [...etat.depenses].sort((a, b) => (a.date < b.date ? 1 : -1)),
    creerDepense: async (d, j) => (etat.depenses.push({ ...d, id: id(), justificatif_chemin: j ? `demo/${j.nom}` : null }), etat.depenses.at(-1)!.id),
    lienJustificatif: async () => null,
    declarations: async () => [...etat.declarations],
    async marquerDeclare(annee, trimestre, montant) {
      etat.declarations = etat.declarations.filter((d) => !(d.annee === annee && d.trimestre === trimestre));
      etat.declarations.push({ id: id(), annee, trimestre, montant_declare: montant, declare_le: aujourdhui() });
    },
    journal: async (oid) => etat.journal.filter((j) => j.objet_id === oid),
  };
}
