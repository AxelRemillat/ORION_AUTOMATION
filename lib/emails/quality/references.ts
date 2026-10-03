/**
 * MAILS DE RÉFÉRENCE du juge.
 *
 * - CIBLE : le mail « 9/10 » qu'Axel a écrit pour LE PAIN DE BELLEDONNE le
 *   03/10/2026 — le niveau à atteindre, dans le gabarit actuel ;
 * - RÉFÉRENCES : quatre intros réellement envoyées (BRIOL, BONNIN, ARTFLEX,
 *   BOUVET CARTIER), retenues pour la justesse de leur accroche. Elles datent
 *   de l'ancien gabarit : « flux » et l'absence de lien de démo y sont des
 *   défauts que la grille actuelle sanctionne.
 *
 * Mention « stop » et signature retirées : elles sont posées par le code et ne
 * sont pas notées.
 */

export const TARGET_EXAMPLE = `Bonjour Monsieur Anquetil,

Avec quatre fournils et des clients en restauration, chaque commande doit être saisie, vérifiée puis confirmée au bon site. C'est souvent là que les délais se perdent.

J'automatise ce type de tâche pour des PME : la commande reçue par mail est saisie dans votre outil et la confirmation part après votre validation.

Exemple testable en une minute : axelremillat.com/automatisations

Auriez-vous 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?`;

export const REFERENCE_MAILS: { company: string; body: string }[] = [
  {
    company: "BRIOL DIFFUSION",
    body: `Bonjour Monsieur Briol,

Avec trois showrooms et une douzaine de commerciaux, chaque demande de devis (fenêtres, portes, cuisines) doit être triée, chiffrée puis relancée, souvent à la main.

Je suis Axel Remillat, je construis des automatisations et agents IA pour PME. J'ai conçu un agent qui transforme une demande client en devis, réponse et rendez-vous, testable sur mon site.

Chez vous, il pourrait qualifier les demandes du site et des showrooms, préparer un pré-devis et proposer un créneau de métré au bon commercial. Mise en place en 2 à 3 semaines.

Auriez-vous 15 minutes cette semaine pour en parler ?`,
  },
  {
    company: "SARL BONNIN FRERES",
    body: `Bonjour Monsieur Bonnin,

Avec un laboratoire qui alimente toutes vos boutiques, les commandes de chaque magasin, du click & collect et du traiteur doivent chaque jour se retrouver dans une seule liste de production.

Je suis Axel Remillat, je construis des automatisations et agents IA pour PME, avec des exemples testables sur mon site.

Chez vous, un flux pourrait regrouper automatiquement ces commandes en fiches de production par produit et par boutique, et signaler les oublis. Mise en place en 2 à 3 semaines.

Auriez-vous 15 minutes pour que je vous montre à quoi ça ressemblerait ?`,
  },
  {
    company: "ARTFLEX",
    body: `Bonjour Monsieur Romeo,

Chez un distributeur de robinetterie industrielle, chaque demande de prix arrive avec ses références, diamètres et pressions, puis doit être ressaisie avant d'être chiffrée.

J'automatise ce type de tâches pour les PME avec l'IA. Sur mon site, un agent transforme une demande client en devis structuré, testable avec un exemple de négoce B2B.

Chez vous, il pourrait lire les demandes reçues, retrouver les articles dans votre catalogue et préparer un pré-devis à valider par vos technico-commerciaux.

Auriez-vous 15 minutes pour que je vous montre à quoi ça ressemblerait ?`,
  },
  {
    company: "BOUVET CARTIER IMMOBILIER",
    body: `Bonjour Madame Bouvet,

Entre le syndic, la gestion locative et la transaction, votre accueil reçoit des demandes très différentes : un sinistre, une visite, une question de charges.

Je suis Axel Remillat, j'automatise ce type de tâches pour les PME avec l'IA. Sur mon site, une démo trie des e-mails entrants en direct.

Chez vous, un flux lirait chaque demande, repérerait le bien et le motif, puis préparerait une réponse et l'orientation vers le bon gestionnaire, à valider par l'équipe.

Auriez-vous 15 minutes pour que je vous montre à quoi ça ressemblerait ?`,
  },
];
