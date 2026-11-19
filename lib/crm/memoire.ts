/**
 * CRM — dépôt EN MÉMOIRE du mode démo local (lib/demo.ts) : captures et tests Playwright sans base.
 * Les fiches autres qu'Optique des Alpes sont FICTIVES et marquées « exemple » dans leurs notes. Les données vivent
 * le temps du processus `next dev` ; rien n'est écrit nulle part.
 */
import { aujourdhuiParis } from "./logique";
import { OFFRES_INITIALES, type Commerce, type Evenement, type Offre } from "./types";
import type { DepotCrm, NouvelEvenement } from "./depot";

// Identifiants aléatoires : en `next dev`, chaque route a sa propre copie de ce module (un compteur repartirait de
// zéro et donnerait à une nouvelle fiche l'identifiant d'une ancienne), alors que l'état est partagé (globalThis).
const id = () => `demo-${globalThis.crypto.randomUUID()}`;
const jour = (decalage: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + decalage);
  return aujourdhuiParis(d);
};

function fiche(p: Partial<Commerce> & { nom: string }): Commerce {
  const maintenant = new Date().toISOString();
  return {
    id: id(), metier: null, ville: null, adresse: null, telephone: null, instagram: null, fiche_google: null, site_existant: null,
    site_url: null, siren: null, contact_prenom: null, contact_role: null, canal: "terrain", maquette_url: null, notes: null,
    etape: "a_contacter", motif_perte: null, etape_le: maintenant, prochaine_action: null, prochaine_action_le: null, offre_id: null,
    montant_devis: null, date_signature: null, accord_demo: false, accord_demo_le: null, prospect_id: null, plateforme_client_id: null,
    archivee_le: null, created_at: maintenant, updated_at: maintenant, ...p,
  };
}

interface Etat {
  offres: Offre[];
  commerces: Commerce[];
  evenements: Evenement[];
}

function graines(): Etat {
  const offres: Offre[] = OFFRES_INITIALES.map((o, i) => ({ id: id(), libelle: o.libelle, description: o.description, prix_indicatif: o.prix_indicatif, ordre: i, active: true }));
  const ex = "Fiche d'exemple (mode démo).";
  const commerces: Commerce[] = [
    fiche({ nom: "Optique des Alpes", metier: "Opticien", ville: "La Mure", adresse: "2 place Pasteur, 38350 La Mure", telephone: "04 76 81 27 73", site_existant: true, contact_prenom: "Guillaume", contact_role: "Gérant", canal: "terrain", etape: "en_ligne", notes: "Premier client du Web des Artisans. Site V1 en ligne.", prochaine_action: "Recueillir 3 avis Google et les horaires", prochaine_action_le: jour(0) }),
    fiche({ nom: "Boulangerie du Pont", metier: "Boulangerie", ville: "Vizille", telephone: "04 00 00 00 01", canal: "terrain", etape: "rdv", prochaine_action: "RDV : présenter la maquette", prochaine_action_le: jour(-1), notes: ex }),
    fiche({ nom: "Salon Mèches & Ciseaux", metier: "Coiffure", ville: "La Mure", instagram: "@meches.ciseaux", canal: "instagram", etape: "maquette_envoyee", prochaine_action: "Relancer après la maquette", prochaine_action_le: jour(0), notes: ex }),
    fiche({ nom: "Plomberie Matheysine", metier: "Plombier", ville: "Susville", canal: "telephone", etape: "contacte", prochaine_action: "Rappeler à 18 h", prochaine_action_le: jour(2), notes: ex }),
    fiche({ nom: "Fromagerie des Alpages", metier: "Fromagerie", ville: "Grenoble", canal: "prescripteur", etape: "devis_envoye", montant_devis: 590, prochaine_action: "Relancer le devis", prochaine_action_le: jour(-3), notes: ex }),
    fiche({ nom: "Garage du Drac", metier: "Garage", ville: "Vif", canal: "entrant", etape: "a_contacter", notes: ex }),
    fiche({ nom: "Fleurs de Matheysine", metier: "Fleuriste", ville: "La Mure", canal: "terrain", etape: "signe", montant_devis: 590, date_signature: jour(-6), accord_demo: true, accord_demo_le: jour(-6), prochaine_action: "Envoyer les accès", prochaine_action_le: jour(1), notes: ex }),
    fiche({ nom: "Cave Saint-Roch", metier: "Caviste", ville: "Grenoble", canal: "terrain", etape: "perdu", motif_perte: "A déjà un prestataire", notes: ex }),
  ];
  commerces[0].offre_id = offres[0].id;
  commerces[6].offre_id = offres[0].id;
  commerces[4].offre_id = offres[0].id;
  const optique = commerces[0].id;
  const evt = (commerce_id: string, type: Evenement["type"], contenu: string, decalage: number): Evenement => ({
    id: id(), commerce_id, type, contenu, survenu_le: new Date(Date.now() + decalage * 86_400_000).toISOString(), meta: {},
  });
  const evenements: Evenement[] = [
    evt(optique, "visite", "Rendez-vous en boutique : choix du modèle dans le Studio", -6),
    evt(optique, "etape", "Devis envoyé → Signé", -5),
    evt(optique, "etape", "Signé → En ligne", -2),
    evt(optique, "note", "Avis Google et horaires à récupérer auprès de Guillaume", -1),
    evt(commerces[1].id, "appel", "Intéressé, RDV pris en boutique", -4),
  ];
  return { offres, commerces, evenements };
}

const g = globalThis as unknown as { __orionCrmDemo?: Etat };

export function depotMemoire(): DepotCrm {
  const etat = (g.__orionCrmDemo ??= graines());
  const cloner = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    async commerces({ archives = false } = {}) {
      return cloner(etat.commerces.filter((c) => archives || !c.archivee_le));
    },
    async commerce(i) {
      return cloner(etat.commerces.find((c) => c.id === i) ?? null);
    },
    async creer(valeurs) {
      const c = fiche(valeurs);
      etat.commerces.unshift(c);
      return cloner(c);
    },
    async modifier(i, valeurs) {
      const c = etat.commerces.find((x) => x.id === i);
      if (!c) throw new Error("CRM : fiche introuvable");
      Object.assign(c, valeurs, { updated_at: new Date().toISOString() });
      return cloner(c);
    },
    async evenements(commerceId) {
      // Le plus récent d'abord ; à égalité (même milliseconde), le dernier inséré d'abord, comme `created_at desc` en base.
      const rang = new Map(etat.evenements.map((e, i) => [e.id, i]));
      return cloner(etat.evenements.filter((e) => e.commerce_id === commerceId).sort((a, b) => b.survenu_le.localeCompare(a.survenu_le) || (rang.get(b.id) ?? 0) - (rang.get(a.id) ?? 0)));
    },
    async ajouterEvenement(commerceId, e: NouvelEvenement) {
      const ev: Evenement = { id: id(), commerce_id: commerceId, type: e.type, contenu: e.contenu ?? null, survenu_le: e.survenu_le ?? new Date().toISOString(), meta: e.meta ?? {} };
      etat.evenements.push(ev);
      return cloner(ev);
    },
    async offres() {
      return cloner(etat.offres);
    },
  };
}

/** Remet le mode démo à l'état initial (tests Playwright). */
export function reinitialiserDemo(): void {
  g.__orionCrmDemo = graines();
}
