// Données de DÉMONSTRATION (mode démo local et tests) : clients, montants et adresse sont FICTIFS. Seuls le nom d'Axel et
// le SIRET viennent de Cowork #70. Rien de tout cela n'est écrit en base. L'état est construit en rejouant les opérations
// du dépôt mémoire, date par date : numéros, avoirs et journal sont produits par le même code que l'application.
import { depotMemoire, type EtatMemoire } from "./depot-memoire";

export const AUJOURDHUI_DEMO = "2026-11-18";

export function etatVide(): EtatMemoire {
  return { parametres: null, clients: [], devis: [], factures: [], encaissements: [], depenses: [], declarations: [], journal: [], compteurs: {} };
}

export async function etatDemo(): Promise<EtatMemoire> {
  const etat = etatVide();
  let jour = "2026-09-01";
  const d = depotMemoire(etat, () => jour);
  const le = (j: string) => (jour = j);
  await d.enregistrerParametres({
    nom: "Axel Remillat",
    adresse: "12 rue de l'Exemple (adresse fictive de démonstration)\n74000 Annecy",
    siret: "109 144 477 00014",
    email: "contact@exemple.fr",
    telephone: null,
    iban: null,
    date_debut_activite: "2026-09-01",
    acre: true,
  });
  const boulangerie = await d.creerClient({ nom: "Boulangerie Exemple (fictive)", professionnel: true, siren: "000 000 001", adresse: "1 place du Marché\n74000 Annecy", email: null, crm_ref: null });
  const opticien = await d.creerClient({ nom: "Optique Exemple (fictive)", professionnel: true, siren: "000 000 002", adresse: "5 avenue des Alpes\n74000 Annecy", email: null, crm_ref: null });
  const particulier = await d.creerClient({ nom: "Camille Exemple (fictive)", professionnel: false, siren: null, adresse: "8 chemin des Prés\n74940 Annecy-le-Vieux", email: null, crm_ref: null });

  // Septembre : devis accepté → facture, payée.
  le("2026-09-08");
  const d1 = await d.creerDevis({ client_id: boulangerie, objet: "Site vitrine", lignes: [{ designation: "Site vitrine 5 pages, mise en ligne", quantite: 1, prix_unitaire: 120_000 }, { designation: "Photos de la boutique (demi-journée)", quantite: 1, prix_unitaire: 25_000 }], validite_jours: 30, conditions: "Acompte de 30 % à la commande." });
  await d.modifierDevis(d1, { statut: "envoye" });
  le("2026-09-15");
  const f1 = await d.devisVersFacture(d1);
  await d.modifierBrouillon(f1, { date_prestation: "septembre 2026" });
  le("2026-09-30");
  await d.emettre(f1);
  le("2026-10-12");
  await d.creerEncaissement({ date: "2026-10-12", montant: 145_000, moyen: "virement", facture_id: f1, client_id: boulangerie, nature: "Site vitrine", reference: "VIR 0412" });

  // Particulier : facture émise en octobre, échéance dépassée.
  le("2026-10-02");
  const f3 = await d.creerFacture({ client_id: particulier, objet: "Petit site personnel", lignes: [{ designation: "Site une page", quantite: 1, prix_unitaire: 29_000 }], date_prestation: "02/10/2026", echeance_jours: 15 });
  await d.emettre(f3);

  // Octobre : facture opticien, payée en partie, avoir de remise.
  le("2026-10-20");
  const f2 = await d.creerFacture({ client_id: opticien, objet: "Refonte du site et prise de rendez-vous", lignes: [{ designation: "Refonte du site", quantite: 1, prix_unitaire: 180_000 }, { designation: "Module de prise de rendez-vous", quantite: 1, prix_unitaire: 40_000 }], date_prestation: "octobre 2026", echeance_jours: 30 });
  await d.emettre(f2);
  le("2026-10-28");
  const a1 = await d.creerAvoir(f2, [{ designation: "Remise commerciale sur le module de rendez-vous", quantite: 1, prix_unitaire: 10_000 }], "Remise commerciale");
  await d.emettre(a1);
  le("2026-11-05");
  await d.creerEncaissement({ date: "2026-11-05", montant: 100_000, moyen: "virement", facture_id: f2, client_id: opticien, nature: "Refonte du site (acompte)", reference: "VIR 1105" });

  // Novembre : un devis envoyé, une facture en brouillon, des dépenses.
  le("2026-11-10");
  const d2 = await d.creerDevis({ client_id: opticien, objet: "Maintenance annuelle", lignes: [{ designation: "Maintenance et mises à jour (mois)", quantite: 12, prix_unitaire: 1_900 }], validite_jours: 30, conditions: "Facturation trimestrielle." });
  await d.modifierDevis(d2, { statut: "envoye" });
  le("2026-11-16");
  await d.creerFacture({ client_id: boulangerie, objet: "Ajout d'une page « Commandes »", lignes: [{ designation: "Page commandes", quantite: 1, prix_unitaire: 29_000 }], date_prestation: "novembre 2026", echeance_jours: 30 });
  await d.creerDepense({ date: "2026-09-03", montant: 1_199, fournisseur: "Hébergeur (fictif)", nature: "Nom de domaine et hébergement" }, { nom: "facture-hebergeur.pdf", type: "application/pdf", octets: new Uint8Array() });
  await d.creerDepense({ date: "2026-10-14", montant: 2_400, fournisseur: "Éditeur de logiciel (fictif)", nature: "Abonnement logiciel de retouche" });
  le(AUJOURDHUI_DEMO);
  return etat;
}
