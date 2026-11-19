/**
 * Lien CRM → plateforme `mon-site.webdesartisans.fr` (agent3), PRÉPARÉ mais NON BRANCHÉ (Cowork #117).
 *
 * Quand agent3 exposera son API, `creerClientPlateforme()` créera l'espace client du commerce signé et renverra son
 * identifiant, à ranger dans `crm_commerces.plateforme_client_id`. D'ici là, elle refuse proprement (et le bouton
 * « Créer l'espace client sur la plateforme » est désactivé dans la fiche).
 *
 * Contrat attendu (à confirmer avec agent3) :
 *   POST {PLATEFORME_API_URL}/admin/clients   Authorization: Bearer {PLATEFORME_API_TOKEN}
 *   corps : DonneesClientPlateforme            réponse 201 : { id: string, url: string }
 *   idempotent sur `crmCommerceId` : un second appel renvoie le même espace, sans doublon.
 */
import type { Commerce } from "./types";

export interface DonneesClientPlateforme {
  /** Identifiant de la fiche CRM, clé d'idempotence côté plateforme. */
  crmCommerceId: string;
  nom: string;
  metier: string | null;
  ville: string | null;
  adresse: string | null;
  telephone: string | null;
  siren: string | null;
  contact: { prenom: string | null; role: string | null };
  offre: string | null;
  /** Lien vers le projet du Studio (maquette), pour importer la structure et le style. */
  maquetteUrl: string | null;
  /** Accord de démonstration signé : la plateforme peut montrer le site et ses chiffres à des prospects. */
  accordDemonstration: { signe: boolean; le: string | null };
}

export type ResultatPlateforme = { ok: true; id: string; url: string } | { ok: false; error: string; nonBranche?: true };

/** La plateforme est-elle branchée ? (variables posées par Axel quand l'API d'agent3 existera) */
export const plateformeBranchee = (env: Record<string, string | undefined> = process.env) =>
  Boolean(env.PLATEFORME_API_URL && env.PLATEFORME_API_TOKEN);

/** Code pur : les données envoyées à la plateforme pour une fiche (testé). */
export function donneesPourPlateforme(c: Commerce, offreLibelle: string | null): DonneesClientPlateforme {
  return {
    crmCommerceId: c.id,
    nom: c.nom,
    metier: c.metier,
    ville: c.ville,
    adresse: c.adresse,
    telephone: c.telephone,
    siren: c.siren,
    contact: { prenom: c.contact_prenom, role: c.contact_role },
    offre: offreLibelle,
    maquetteUrl: c.maquette_url,
    accordDemonstration: { signe: c.accord_demo, le: c.accord_demo_le },
  };
}

/** Crée l'espace client. NON BRANCHÉ pour l'instant : renvoie `nonBranche` sans aucun appel réseau. */
export async function creerClientPlateforme(_donnees: DonneesClientPlateforme): Promise<ResultatPlateforme> {
  return { ok: false, nonBranche: true, error: "Plateforme pas encore branchée : l'API d'agent3 n'est pas disponible." };
}
