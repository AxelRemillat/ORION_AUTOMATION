/**
 * CRM du Web des Artisans (Cowork #117) — types et listes de référence.
 * Les valeurs (`id`) sont celles des contraintes CHECK de la migration 20261118154034_crm_commerces.sql : ne pas en
 * changer une sans migration.
 */

export const ETAPES = [
  { id: "a_contacter", libelle: "À contacter", court: "À contacter" },
  { id: "contacte", libelle: "Contacté", court: "Contacté" },
  { id: "maquette_envoyee", libelle: "Maquette envoyée", court: "Maquette" },
  { id: "rdv", libelle: "RDV", court: "RDV" },
  { id: "devis_envoye", libelle: "Devis envoyé", court: "Devis" },
  { id: "signe", libelle: "Signé", court: "Signé" },
  { id: "en_ligne", libelle: "En ligne", court: "En ligne" },
  { id: "perdu", libelle: "Perdu", court: "Perdu" },
] as const;
export type Etape = (typeof ETAPES)[number]["id"];

export const CANAUX = [
  { id: "terrain", libelle: "Terrain" },
  { id: "telephone", libelle: "Téléphone" },
  { id: "instagram", libelle: "Instagram" },
  { id: "prescripteur", libelle: "Prescripteur" },
  { id: "entrant", libelle: "Entrant" },
  { id: "upwork_comeup", libelle: "Upwork / ComeUp" },
  { id: "prospection_email", libelle: "Prospection e-mail (archive)" },
] as const;
export type Canal = (typeof CANAUX)[number]["id"];

export const TYPES_EVENEMENT = [
  { id: "appel", libelle: "Appel" },
  { id: "visite", libelle: "Visite" },
  { id: "message", libelle: "Message" },
  { id: "rdv", libelle: "RDV" },
  { id: "devis", libelle: "Devis" },
  { id: "note", libelle: "Note" },
  { id: "etape", libelle: "Étape" },
] as const;
export type TypeEvenement = (typeof TYPES_EVENEMENT)[number]["id"];

/**
 * Offres proposées à la création de la liste (`crm_offres` vide) : celles du site webdesartisans.fr au 18/11/2026
 * (dépôt PIGNON, config/offres.ts, prix pleins hors promotion). La liste vit ensuite en base et se modifie librement.
 */
export const OFFRES_INITIALES = [
  { libelle: "Essentiel", description: "Paiement unique : le site et le nom de domaine sont au client", prix_indicatif: 590 },
  { libelle: "Sérénité", description: "Abonnement tout compris, sans frais de départ (prix mensuel)", prix_indicatif: 59 },
  { libelle: "Sur-mesure", description: "Sur devis, selon le besoin (à partir de)", prix_indicatif: 900 },
] as const;

export interface Offre {
  id: string;
  libelle: string;
  description: string | null;
  prix_indicatif: number | null;
  ordre: number;
  active: boolean;
}

export interface Commerce {
  id: string;
  nom: string;
  metier: string | null;
  ville: string | null;
  adresse: string | null;
  telephone: string | null;
  instagram: string | null;
  fiche_google: string | null;
  site_existant: boolean | null;
  site_url: string | null;
  siren: string | null;
  contact_prenom: string | null;
  contact_role: string | null;
  canal: Canal;
  maquette_url: string | null;
  notes: string | null;
  etape: Etape;
  motif_perte: string | null;
  etape_le: string;
  prochaine_action: string | null;
  prochaine_action_le: string | null;
  offre_id: string | null;
  montant_devis: number | null;
  date_signature: string | null;
  accord_demo: boolean;
  accord_demo_le: string | null;
  prospect_id: string | null;
  plateforme_client_id: string | null;
  archivee_le: string | null;
  created_at: string;
  updated_at: string;
}

export interface Evenement {
  id: string;
  commerce_id: string;
  type: TypeEvenement;
  contenu: string | null;
  survenu_le: string;
  meta: Record<string, unknown>;
}

export const libelleEtape = (id: string) => ETAPES.find((e) => e.id === id)?.libelle ?? id;
export const libelleCanal = (id: string) => CANAUX.find((c) => c.id === id)?.libelle ?? id;
export const libelleTypeEvenement = (id: string) => TYPES_EVENEMENT.find((t) => t.id === id)?.libelle ?? id;
export const estEtape = (v: unknown): v is Etape => ETAPES.some((e) => e.id === v);
export const estCanal = (v: unknown): v is Canal => CANAUX.some((c) => c.id === v);
export const estTypeEvenement = (v: unknown): v is TypeEvenement => TYPES_EVENEMENT.some((t) => t.id === v);
