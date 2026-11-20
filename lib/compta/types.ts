// Comptabilité de la micro-entreprise d'Axel (Cowork #70) : types partagés par la base, les calculs, les PDF et l'écran.
// Montants en CENTIMES (entiers) : aucun arrondi flottant sur un total de facture.

export type Centimes = number;

export type ClientCompta = {
  id: string;
  nom: string;
  /** Client professionnel : l'indemnité forfaitaire de 40 € figure sur ses factures. */
  professionnel: boolean;
  siren: string | null;
  adresse: string;
  email: string | null;
  /** Fiche CRM d'agent2, si elle existe (liaison optionnelle, sans clé étrangère tant que le CRM n'est pas fusionné). */
  crm_ref: string | null;
};

export type Ligne = { designation: string; quantite: number; prix_unitaire: Centimes };

export type StatutDevis = "brouillon" | "envoye" | "accepte" | "refuse";

export type Devis = {
  id: string;
  numero: string; // D-AAAA-NNN, attribué à la création
  client_id: string;
  date: string; // AAAA-MM-JJ
  validite_jours: number;
  conditions: string;
  objet: string;
  lignes: Ligne[];
  total: Centimes;
  statut: StatutDevis;
  facture_id: string | null;
};

/** État en base : seul le brouillon est modifiable ; une facture émise ne change plus (correction par avoir). */
export type EtatFacture = "brouillon" | "emise";
export type TypeFacture = "facture" | "avoir";

export type Facture = {
  id: string;
  type: TypeFacture;
  numero: string | null; // F-AAAA-NNN ou A-AAAA-NNN, attribué à l'émission seulement
  etat: EtatFacture;
  client_id: string;
  objet: string;
  date_emission: string | null;
  date_prestation: string; // date ou période de la prestation (texte libre court accepté : « novembre 2026 »)
  echeance_jours: number;
  lignes: Ligne[];
  total: Centimes;
  devis_id: string | null;
  /** Avoir : la facture qu'il corrige. */
  facture_origine_id: string | null;
  motif_avoir: string | null;
  /** Coordonnées figées à l'émission (null tant que brouillon). */
  emetteur: Emetteur | null;
  client: ClientFige | null;
};

export type Emetteur = { nom: string; adresse: string; siret: string; email: string | null; telephone: string | null; iban: string | null };
export type ClientFige = { nom: string; adresse: string; siren: string | null; professionnel: boolean; email: string | null };

export type Parametres = Emetteur & { date_debut_activite: string | null; acre: boolean };

/** Statut de paiement, calculé (jamais stocké) à partir des encaissements, des avoirs et de l'échéance. */
export type StatutPaiement = "brouillon" | "emise" | "payee_partiellement" | "payee" | "en_retard" | "soldee_par_avoir";

export type MoyenPaiement = "virement" | "cheque" | "especes" | "carte" | "plateforme" | "autre";

export type Encaissement = {
  id: string;
  date: string;
  montant: Centimes; // négatif pour un remboursement
  moyen: MoyenPaiement;
  facture_id: string | null;
  client_id: string;
  nature: string;
  reference: string | null; // n° de pièce, de virement…
};

export type Depense = {
  id: string;
  date: string;
  montant: Centimes;
  fournisseur: string;
  nature: string;
  justificatif_chemin: string | null;
};

export type Declaration = {
  id: string;
  annee: number;
  trimestre: 1 | 2 | 3 | 4;
  montant_declare: Centimes;
  declare_le: string;
};

export type EntreeJournal = { id: string; quand: string; objet: "devis" | "facture"; objet_id: string; action: string; detail: string | null };
