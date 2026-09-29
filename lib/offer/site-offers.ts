/**
 * LES OFFRES DU SITE — copie, pas source.
 *
 * SOURCE DE VÉRITÉ : dépôt PORTFOLIO_V2, components/offres/offres-data.ts
 * (affichées sur https://axelremillat.com/offres). ORION ne vend rien d'autre :
 * mêmes intitulés, mêmes prix « à partir de ».
 *
 * Pourquoi une copie : lire le site à l'exécution ferait dépendre /offre (et
 * tout ce qui s'appuie dessus) d'un déploiement Vercel et d'un format HTML qui
 * peut changer sans prévenir. La copie est vérifiable en une commande :
 *   npm run check:site-offers   (compare avec la page /offres en ligne)
 *
 * Quand une offre change sur le site : mettre à jour ce fichier, relancer la
 * commande ci-dessus.
 *
 * Module pur, sans dépendance : importable par une page client comme par une route.
 */

export interface SiteOffer {
  name: string;
  /** Tel qu'affiché sur le site : « À partir de 290 € ». */
  price: string;
  priceNote: string;
  pitch: string;
}

export const SITE_OFFERS_SOURCE = "PORTFOLIO_V2/components/offres/offres-data.ts";
export const SITE_OFFERS_URL = "https://axelremillat.com/offres";

export const SITE_OFFERS: readonly SiteOffer[] = [
  {
    name: "Audit automatisation",
    price: "À partir de 290 €",
    priceNote: "forfait",
    pitch: "Une demi-journée pour repérer et chiffrer les 3 tâches à automatiser en premier.",
  },
  {
    name: "Automatisation clé en main",
    price: "À partir de 1 200 €",
    priceNote: "par flux",
    pitch: "Un flux livré et testé en 2 à 3 semaines, branché sur vos outils.",
  },
  {
    name: "Suivi & évolutions",
    price: "À partir de 190 €/mois",
    priceNote: "par mois",
    pitch: "Surveillance, corrections, petites évolutions, sans engagement.",
  },
  {
    name: "Mise en production IA",
    price: "À partir de 1 900 €",
    priceNote: "selon le projet",
    pitch: "Pour les équipes qui ont déjà un prototype IA.",
  },
];
