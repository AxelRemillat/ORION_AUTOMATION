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

/**
 * RÉFÉRENCES 10/10 DE COWORK — exemples du générateur ET du juge. Chaque mail
 * réécrit par Cowork et noté 10/10 s'ajoute ici (itérations qualité).
 */
export const COWORK_REFERENCES: { company: string; body: string }[] = [
  {
    company: "KOMAKS FRANCE",
    body: `Bonjour Monsieur Ivanov,

Avec un catalogue qui mêle consommables d'impression et matériel informatique, chaque commande demande de vérifier le stock référence par référence. Quand un article manque, le client attend votre retour.

J'automatise ce type de tâche pour des PME : chaque commande reçue par e-mail est lue, les références disponibles partent en liste de prélèvement et les manquantes vous sont signalées.

Exemple testable en une minute : axelremillat.com/automatisations?demo=email

Auriez-vous 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?`,
  },
];

/**
 * ÉTALONNAGE DU JUGE — mails notés par Cowork (itération 1, 04/10/2026), avec
 * la raison. Le juge doit retrouver ces notes à ±0,5 : il était trop indulgent
 * d'environ 1,5 point.
 */
export const CALIBRATION: { company: string; hook: string; proposal: string; score: number; why: string }[] = [
  {
    company: "LE PAIN DE BELLEDONNE",
    hook: "Vos quatre fournils livrent aussi des clients en restauration hors domicile. Chaque commande demande de vérifier les quantités avant de confirmer une date de livraison.",
    proposal: "J'automatise ce type de tâche pour des PME : les commandes reçues par e-mail sont triées et inscrites dans le suivi des commandes, sans ressaisie des références.",
    score: 9,
    why: "Bon fait propre (quatre fournils, restauration). La seconde phrase reste un peu générique.",
  },
  {
    company: "KOMAKS FRANCE",
    hook: "Vous vendez des consommables d'impression aux côtés de matériel bureautique et informatique. Vérifier leur disponibilité et préparer les listes de prélèvement prend du temps.",
    proposal: "J'automatise ce type de tâche pour des PME : les commandes reçues par e-mail sont triées et leurs références disponibles inscrites sur une liste de prélèvement, sans ressaisie.",
    score: 8,
    why: "« Vous vendez… aux côtés de… » paraphrase leur activité ; « prend du temps » est une conséquence molle.",
  },
  {
    company: "AKTID",
    hook: "Vos projets de centres de tri clés en main mobilisent des commandes auprès de fournisseurs. Suivre leurs confirmations et leurs dates de livraison prend du temps aux achats.",
    proposal: "J'automatise ce type de tâche pour des PME : les confirmations reçues par e-mail mettent à jour le suivi des commandes, et les relances sont préparées sans oubli ni ressaisie.",
    score: 9,
    why: "Accroche concrète ; « prend du temps aux achats » est maladroit.",
  },
  {
    company: "ACTUEL VERANDA ET MENUISERIE",
    hook: "Entre vérandas, menuiserie métallique et serrurerie, vos demandes ne portent pas toutes sur les mêmes travaux. Une demande en attente d'une réponse ou d'une pièce peut passer inaperçue.",
    proposal: "J'automatise ce type de tâche pour des PME : les e-mails reçus sont classés et les demandes à relancer signalées, sans oubli dans le suivi.",
    score: 9,
    why: "Bon : la conséquence (« peut passer inaperçue ») est concrète.",
  },
  {
    company: "SPI ENERGIE",
    hook: "Spi Energie travaille dans le génie climatique, le froid et la maintenance technique. Quand un article manque, l'équipe perd du temps à retrouver la demande et à préparer sa commande.",
    proposal: "J'automatise ce type de tâche pour des PME : les demandes reçues par e-mail sont triées et les commandes fournisseurs préparées, sans ressaisie pour l'équipe chargée du stock.",
    score: 6,
    why: "« Spi Energie travaille dans… » est une paraphrase ; le pain est supposé.",
  },
  {
    company: "AGCEI",
    hook: "Vous fabriquez des équipements électriques. Quand une commande fournisseur attend une confirmation, retrouver le bon échange peut prendre du temps.",
    proposal: "J'automatise ce type de tâche pour des PME : les e-mails liés aux commandes fournisseurs sont triés et les relances à faire sont signalées, sans oubli dans la boîte de réception.",
    score: 6,
    why: "Aucun fait propre ; pain supposé.",
  },
  {
    company: "LYPSIS",
    hook: "Dans le commerce de gros, une demande de prix peut réunir plusieurs références et quantités. Trier ces demandes et suivre les réponses en attente prend du temps.",
    proposal: "J'automatise ce type de tâche pour des PME : si vos demandes arrivent par mail, elles sont triées et les relances sont préparées pour validation, sans ressaisie ni oubli.",
    score: 6,
    why: "Accroche par le secteur, hypothèse visible (« si vos demandes »).",
  },
  {
    company: "C.T.A.",
    hook: "Dans le commerce de gros, les demandes s'accompagnent de documents commerciaux et administratifs à préparer. Leur classement dans le bon dossier prend aussi du temps.",
    proposal: "J'automatise ce type de tâche pour des PME : les documents se préremplissent à partir des pièces reçues par mail et leur classement vous est proposé, sans ressaisie.",
    score: 5,
    why: "Accroche par le secteur, pain vague (« documents administratifs »).",
  },
];
