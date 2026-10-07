/**
 * JEU D'ÉTALONNAGE « D » (Cowork #34, 07/10/2026) : 15 mails rédigés par la chaîne
 * #32 (mesure de variance), avec le VERDICT HUMAIN de Cowork (grille en 7 points,
 * prêt = 9 ou plus). Référence versionnée de la check-list : « npm run calibrate:judge »
 * vise au moins 13 accords sur 15 ; les tests vérifient les contrôles du code.
 */
import type { MailFamily } from "./families";

export interface CoworkGradedMail {
  company: string;
  family: MailFamily;
  subject: string;
  /** Corps assemblé (salutation → demande), lien de démo compris. */
  core: string;
  coworkReady: boolean;
  coworkScore: string;
  note: string;
}

export const COWORK_D_SET: CoworkGradedMail[] = [
  {
    "company": "VENDREDI-SAMEDI-DIMANCHE-MAINTENANCE (VSDM)",
    "family": "F4",
    "subject": "Demandes de maintenance sur site",
    "core": "Bonjour Monsieur Vigreux,\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=email&v=4\n\nElle lit une demande type et prépare une réponse à valider ; j’appliquerais le même principe à vos demandes de maintenance sur site, pour répondre plus vite aux clients.\n\nJe suis Axel Remillat, freelance en IA et automatisation de tâches pour les PME.\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": false,
    "coworkScore": "7,5–8",
    "note": "F4 : gabarit « Elle lit… » en ouverture, aucun fait sourcé, aucun problème"
  },
  {
    "company": "ICP LOGISTIQUE",
    "family": "F1",
    "subject": "Tri des commandes",
    "core": "Bonjour,\n\nAvec votre trieuse de plus de 4 000 commandes par heure, chaque commande doit rejoindre le bon transporteur. Un e-mail de commande mal aiguillé retarde l’expédition.\n\nJ’automatise le tri des commandes reçues par e-mail : chaque message arrive au bon interlocuteur selon le transporteur indiqué.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=email&v=1\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": false,
    "coworkScore": "8,5",
    "note": "lien « trieuse » → « e-mail de commande » un peu forcé ; le nombre vient du site (garde-fou trop sévère)"
  },
  {
    "company": "CAMEL DIAM",
    "family": "F1",
    "subject": "Devis de mobilier de crèche",
    "core": "Bonjour Monsieur Branquart,\n\nPour vos devis de mobilier de crèche, chaque demande exige de retrouver les bonnes références. Une référence oubliée retarde la réponse au client.\n\nJ'automatise la préparation des devis : je relève les références et quantités demandées, puis vous soumets un devis à valider.\n\nExemple testable en une minute : axelremillat.com/agent?v=1\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": true,
    "coworkScore": "9+",
    "note": ""
  },
  {
    "company": "DELIMBE",
    "family": "F3",
    "subject": "Qui confirme les délais d’épandeurs ?",
    "core": "Bonjour Monsieur Delimbeuf,\n\nQui vérifie les références des épandeurs avant de confirmer les commandes des concessionnaires ?\n\nJ’automatise le tri des e-mails : je signale les références manquantes et envoie les confirmations de délai après validation.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=email&v=3\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?",
    "coworkReady": true,
    "coworkScore": "9+",
    "note": ""
  },
  {
    "company": "CRISTAFLOR",
    "family": "F3",
    "subject": "Des références de lunettes manquantes ?",
    "core": "Bonjour Monsieur Lacommere,\n\nQui vérifie les références manquantes dans les commandes de lunettes de soleil ?\n\nJ'automatise le tri des commandes reçues par e-mail et signale les références de lunettes de soleil manquantes.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=email&v=3\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?",
    "coworkReady": false,
    "coworkScore": "8,5",
    "note": "« lunettes de soleil » répété deux fois"
  },
  {
    "company": "TRANSLOCAUTO",
    "family": "F4",
    "subject": "Demandes de stockage et copacking",
    "core": "Bonjour Madame,\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=email&v=4\n\nElle lit une demande type et prépare une réponse au client à valider ; je peux appliquer ce principe à vos demandes de stockage et de copacking pour répondre plus vite.\n\nJe suis Axel Remillat, freelance en IA et automatisation de tâches pour les PME.\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": false,
    "coworkScore": "7,5–8",
    "note": "F4 : gabarit, ni fait ni problème"
  },
  {
    "company": "BULLY- LES CARS JURASSIENS",
    "family": "F1",
    "subject": "Devis de transferts",
    "core": "Bonjour Madame,\n\nPour vos transferts vers une gare ou un aéroport, un horaire manquant retarde le devis. Le client attend votre réponse.\n\nJ’automatise la préparation de ces devis : je relève les informations reçues, signale les détails manquants et prépare un devis à vérifier par votre équipe.\n\nExemple testable en une minute : axelremillat.com/agent?v=1\n\nSeriez-vous disponible 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?",
    "coworkReady": true,
    "coworkScore": "9+",
    "note": ""
  },
  {
    "company": "INSTAN CARE",
    "family": "F3",
    "subject": "Le suivi des interventions ?",
    "core": "Bonjour Monsieur Frelet,\n\nQui veille au suivi personnalisé de vos interventions à domicile ?\n\nJ'automatise la lecture des factures fournisseurs et signale les écarts avec vos écritures à vérifier.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=invoice&v=3\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?",
    "coworkReady": false,
    "coworkScore": "NON",
    "note": "proposition sans lien avec la question"
  },
  {
    "company": "PARCOME",
    "family": "F4",
    "subject": "Commandes d’emballages de luxe",
    "core": "Bonjour,\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=email&v=4\n\nElle lit une commande type et prépare une confirmation à valider ; je pourrais appliquer ce principe à vos emballages de luxe et signaler un stock insuffisant avant réponse.\n\nJe suis Axel Remillat, freelance en IA et automatisation de tâches pour les PME.\n\nAuriez-vous 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?",
    "coworkReady": false,
    "coworkScore": "7,5–8",
    "note": "F4 : gabarit, ni fait ni problème"
  },
  {
    "company": "PLIMETAL",
    "family": "F3",
    "subject": "Demandes de découpe laser incomplètes ?",
    "core": "Bonjour,\n\nQui repère les informations manquantes dans les demandes de découpe laser avant chiffrage ?\n\nJ'automatise la lecture des e-mails et documents joints : les informations manquantes sont signalées au bureau d'étude.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=email&v=3\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?",
    "coworkReady": false,
    "coworkScore": "NON",
    "note": "passif (« sont signalées ») : à corriger à la rédaction"
  },
  {
    "company": "ANTARES-FRANCE",
    "family": "F3",
    "subject": "Références de pièces de précision ?",
    "core": "Bonjour Monsieur,\n\nQui repère les références manquantes dans les documents clients pour vos pièces de précision ?\n\nJ'automatise la lecture des documents clients : je signale les références manquantes et préremplis les documents commerciaux à valider.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=email&v=3\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?",
    "coworkReady": false,
    "coworkScore": "8",
    "note": "F3 : « documents clients » trop vague, il faut un objet concret"
  },
  {
    "company": "SA SOPRIMA INDUSTRIE",
    "family": "F4",
    "subject": "Confirmations de délai",
    "core": "Bonjour Monsieur Burgun,\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=email&v=4\n\nElle lit une commande type et prépare une confirmation de délai à valider ; je peux appliquer ce principe à vos commandes de freinage et d’étanchéité pour répondre plus vite aux clients.\n\nJe suis Axel Remillat, freelance en IA et automatisation de tâches pour les PME.\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": false,
    "coworkScore": "7,5–8",
    "note": "F4 : gabarit, ni fait ni problème"
  },
  {
    "company": "ARIC S.A.",
    "family": "F4",
    "subject": "Demandes d’étude d’éclairage",
    "core": "Bonjour Monsieur Daric,\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=email&v=4\n\nDans la démo, je lis une demande type et prépare un accusé de réception à valider ; le même principe s’appliquerait à vos demandes d’étude d’éclairage, pour répondre plus vite au client.\n\nJe suis Axel Remillat, freelance en IA et automatisation de tâches pour les PME.\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": false,
    "coworkScore": "8",
    "note": "F4 : « Dans la démo, je lis… », ni fait ni problème"
  },
  {
    "company": "IMAGINE OPTIC",
    "family": "F1",
    "subject": "Commandes de capteurs",
    "core": "Bonjour Monsieur Bereux,\n\nAvec vos capteurs de front d’onde et miroirs déformables, les commandes portent sur des références précises. Une référence oubliée retarde la confirmation au client.\n\nJ'automatise le tri des commandes reçues par e-mail : je relève les références et signale celles à vérifier avant votre réponse au client.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=email&v=1\n\nSeriez-vous disponible 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?",
    "coworkReady": true,
    "coworkScore": "9",
    "note": "excellent fait (capteurs de front d'onde, miroirs déformables)"
  },
  {
    "company": "SARL FIRSTPELLETS",
    "family": "F3",
    "subject": "Des références de granulés manquantes ?",
    "core": "Bonjour Monsieur Vinee,\n\nQui repère les références manquantes dans les commandes de granulés de paille ?\n\nJ'automatise le tri des e-mails : je signale les références manquantes et prépare une confirmation à valider.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=email&v=3\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?",
    "coworkReady": true,
    "coworkScore": "9+",
    "note": ""
  }
];
