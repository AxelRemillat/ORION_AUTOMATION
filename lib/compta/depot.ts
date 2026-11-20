// Accès aux données de la comptabilité : une seule interface, deux implémentations — Supabase (la vraie, protégée par
// la RLS) et mémoire (mode démo local et tests, données factices des fixtures). Les règles fortes (numérotation sans
// trou, facture émise immuable) vivent dans la base ; l'implémentation mémoire les reproduit pour la démo.
import type { ClientCompta, Declaration, Depense, Devis, Encaissement, EntreeJournal, Facture, Ligne, Parametres, StatutDevis } from "./types";

export type NouveauDevis = Pick<Devis, "client_id" | "objet" | "lignes" | "validite_jours" | "conditions"> & { date?: string };
export type NouvelleFacture = Pick<Facture, "client_id" | "objet" | "lignes" | "date_prestation" | "echeance_jours">;
export type NouvelEncaissement = Omit<Encaissement, "id">;
export type NouvelleDepense = Omit<Depense, "id" | "justificatif_chemin">;
export type Justificatif = { nom: string; type: string; octets: Uint8Array };

export interface DepotCompta {
  parametres(): Promise<Parametres | null>;
  enregistrerParametres(p: Parametres): Promise<void>;
  clients(): Promise<ClientCompta[]>;
  creerClient(c: Omit<ClientCompta, "id">): Promise<string>;
  devis(): Promise<Devis[]>;
  creerDevis(d: NouveauDevis): Promise<string>;
  modifierDevis(id: string, patch: Partial<NouveauDevis> & { statut?: StatutDevis }): Promise<void>;
  devisVersFacture(id: string): Promise<string>;
  factures(): Promise<Facture[]>;
  creerFacture(f: NouvelleFacture): Promise<string>;
  modifierBrouillon(id: string, patch: Partial<NouvelleFacture>): Promise<void>;
  supprimerBrouillon(id: string): Promise<void>;
  emettre(id: string): Promise<Facture>;
  creerAvoir(factureId: string, lignes: Ligne[], motif: string): Promise<string>;
  encaissements(): Promise<Encaissement[]>;
  creerEncaissement(e: NouvelEncaissement): Promise<string>;
  depenses(): Promise<Depense[]>;
  creerDepense(d: NouvelleDepense, justificatif?: Justificatif): Promise<string>;
  lienJustificatif(chemin: string): Promise<string | null>;
  declarations(): Promise<Declaration[]>;
  marquerDeclare(annee: number, trimestre: 1 | 2 | 3 | 4, montant: number): Promise<void>;
  journal(objetId: string): Promise<EntreeJournal[]>;
}

/** Erreur métier lisible (message de la base, sans détail technique). */
export class ErreurCompta extends Error {}
