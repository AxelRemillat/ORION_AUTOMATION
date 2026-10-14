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
  /** Douleur DAF / RAF (Cowork #47) : le juge applique l'arbitrage F3 DAF. */
  daf?: boolean;
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

/**
 * GARDE-FOUS F4 (Cowork #35) : mails F4 notés par Cowork, avec le critère qui
 * doit les refuser. VSDM (nouveau gabarit, 8/10) : fait = description du secteur.
 */
export const F4_GUARDS: (CoworkGradedMail & { expectFail: "C1" | "C2" })[] = [
  {
    company: "VENDREDI-SAMEDI-DIMANCHE-MAINTENANCE (VSDM)",
    family: "F4",
    subject: "Demandes d'intervention",
    core: "Bonjour Monsieur Vigreux,\n\nVous assurez la maintenance et le déploiement de parcs informatiques en France et en Belgique. Quand une panne change les priorités, le client attend une réponse rapide.\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=email&v=4\n\nJe lis une demande type et prépare une confirmation de délai à valider ; le même principe s'appliquerait à vos demandes d'intervention.\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    coworkReady: false,
    coworkScore: "8",
    note: "fait = description du secteur ; problème générique ; « Je lis » (c'est la démo qui lit)",
    expectFail: "C1",
  },
];

/**
 * JEU D'ÉTALONNAGE N°2 (Cowork #36, 07/10/2026) : 10 mails du pipeline #35 notés
 * par Cowork ; CAMEL DIAM retirée (« STOP » reçu : plus jamais de mail, même en
 * étalonnage). 2 prêts sur 9. La check-list était trop indulgente sur C1 et C2.
 */
export const COWORK_SET_2: CoworkGradedMail[] = [
  {
    "company": "TELMA",
    "family": "F4",
    "subject": "Accès des distributeurs",
    "core": "Bonjour Monsieur Akafou,\n\nVotre espace Telma est réservé aux distributeurs. Une demande d’accès sans précision sur le distributeur concerné peut nécessiter un échange avant de recevoir une réponse.\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=email&v=4\n\nLa démo lit une demande type reçue par e-mail et prépare une réponse à valider ; le même principe s’appliquerait aux demandes d’accès de vos distributeurs.\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": false,
    "coworkScore": "7",
    "note": "C1 NON : « espace réservé aux distributeurs » décrit une page ; C2 NON : « peut nécessiter un échange » est abstrait"
  },
  {
    "company": "VENDREDI-SAMEDI-DIMANCHE-MAINTENANCE (VSDM)",
    "family": "F4",
    "subject": "Demandes de déploiement",
    "core": "Bonjour Monsieur Vigreux,\n\nVous proposez le stockage et la configuration d’équipements informatiques pour vos clients. Une demande de déploiement incomplète peut retarder la confirmation d’une date d’intervention.\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=email&v=4\n\nLa démo montre une demande type reçue par e-mail et une réponse au client prête à valider ; je pourrais appliquer ce principe à vos demandes de déploiement.\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": false,
    "coworkScore": "7",
    "note": "C1 NON : « stockage et configuration d'équipements » = description d'activité (le problème est bon)"
  },
  {
    "company": "GARDIEN TRANSPORTS (SOGARPAC) (SOGARPAC)",
    "family": "F4",
    "subject": "Factures fournisseurs",
    "core": "Bonjour,\n\nQualimat accompagne la traçabilité de votre parc de véhicules Fonds Mouvants. Une facture fournisseur sans référence au véhicule concerné complique ce suivi ; je signale l’écart avant validation.\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=invoice&v=4\n\nLa démo lit une facture type et montre une facture prête à valider ; le même principe s’appliquerait à vos factures fournisseurs.\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": false,
    "coworkScore": "6",
    "note": "refus du code correct ; fait déformé (Qualimat est un référentiel) ; « je signale » dans l'accroche"
  },
  {
    "company": "PARCOME",
    "family": "F4",
    "subject": "Confirmations de délai",
    "core": "Bonjour,\n\nVos entrepôts en France et en Chine desservent vos sites de stockage aux États-Unis, avec des livraisons par magasin. Une référence manquante peut retarder la confirmation du délai du magasin concerné.\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=email&v=4\n\nLa démo montre comment elle lit une commande et prépare une confirmation de délai à valider ; je peux appliquer ce principe à vos commandes d’emballages sur mesure.\n\nAuriez-vous 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?",
    "coworkReady": false,
    "coworkScore": "8",
    "note": "refus du code correct (« type » manquant) ; fait excellent"
  },
  {
    "company": "ARIC S.A.",
    "family": "F4",
    "subject": "Demandes d’étude d’éclairage",
    "core": "Bonjour Monsieur Daric,\n\nVous proposez des études d’éclairage via un formulaire dédié. Quand un message manque de précisions, je peux signaler les éléments manquants et préparer une réponse au client.\n\nUne démo testable en une minute : axelremillat.com/automatisations?demo=email&v=4\n\nLa démo lit une commande type reçue par e-mail et prépare une confirmation à valider ; le même principe s’appliquerait à vos demandes d’étude.\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": false,
    "coworkScore": "6",
    "note": "C1 NON (formulaire d'études) ; C2 NON (le problème est une proposition) ; démo « commande type » incohérente avec des demandes d'étude"
  },
  {
    "company": "DISTEL",
    "family": "F1",
    "subject": "Demandes de devis",
    "core": "Bonjour Monsieur Dellenbach,\n\nVotre formulaire de devis permet de demander conseil sur les accès en hauteur. Quand une demande manque de précisions, le client attend votre réponse.\n\nJ'automatise le tri des demandes reçues par e-mail : je signale les informations manquantes et transmets les autres à votre équipe commerciale pour préparer les devis.\n\nExemple testable en une minute : axelremillat.com/agent?v=1\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    "coworkReady": false,
    "coworkScore": "7",
    "note": "C2 NON : « le client attend votre réponse » = problème générique"
  },
  {
    "company": "AERONEFS SERVICES",
    "family": "F3",
    "subject": "Qui chiffre les réparations ?",
    "core": "Bonjour Madame Delugin,\n\nQui vérifie les éléments nécessaires au devis pour vos réparations de sous-ensembles aéronautiques ?\n\nJ'automatise la lecture de ces demandes, je signale les précisions manquantes et je prépare le devis pour validation.\n\nExemple testable en une minute : axelremillat.com/agent?v=3\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?",
    "coworkReady": true,
    "coworkScore": "8,5",
    "note": "prêt"
  },
  {
    "company": "DELIMBE",
    "family": "F3",
    "subject": "Des délais à confirmer ?",
    "core": "Bonjour Monsieur Delimbeuf,\n\nQui suit vos commandes d’épandeurs d’engrais en attente de confirmation de délai ?\n\nJ’automatise le tri de ces commandes reçues par e-mail et je signale celles à confirmer.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=email&v=3\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?",
    "coworkReady": true,
    "coworkScore": "8,5",
    "note": "prêt"
  },
  {
    "company": "BEYNAT FERMETURES",
    "family": "F2",
    "subject": "Devis de fermetures",
    "core": "Bonjour Monsieur Rodriguez,\n\nJe me permets de vous contacter : je suis Axel Remillat, freelance en IA et automatisation de tâches pour les PME.\n\nVous créez, vendez et installez des fermetures sur mesure. Sans dimensions, les devis tardent.\n\nJe crée un assistant qui signale les manques et préremplit les devis pour validation par votre équipe.\n\nUne démo proche de ce que vous pourriez avoir chez vous : axelremillat.com/agent?v=2\n\nSeriez-vous disponible 15 minutes la semaine prochaine pour voir si ça s'applique chez vous ?",
    "coworkReady": false,
    "coworkScore": "7",
    "note": "C1 NON (« fermetures sur mesure » = activité) ; C2 NON (« sans dimensions, les devis tardent » générique)"
  }
];

/**
 * GARDE-FOU DAF (Cowork #47) : MAISON JUCLA (#46) répète « avant la clôture ». Avec l'arbitrage F3 DAF, C1 et C2
 * passent ; le refus attendu est D6 (expression de 3 mots répétée).
 */
export const DAF_GUARDS: (CoworkGradedMail & { expectFail: "D6" })[] = [
  {
    company: "MAISON JUCLA",
    family: "F3",
    subject: "Vos écarts sur factures fournisseurs ?",
    core: "Bonjour Monsieur Jucla,\n\nQui repère les écarts de quantité sur vos factures fournisseurs avant la clôture ?\n\nJ’automatise leur rapprochement avec les commandes et bons de livraison, et je signale les écarts avant la clôture.\n\nExemple testable en une minute : axelremillat.com/automatisations?demo=invoice&v=3\n\nAuriez-vous 15 minutes la semaine prochaine pour en parler ?",
    coworkReady: false,
    coworkScore: "8",
    note: "« avant la clôture » deux fois",
    daf: true,
    expectFail: "D6",
  },
];

/**
 * JEU N°3 (Cowork #57) : A/B du rédacteur, notation de Cowork. WENABI : « candidatures associatives » n'est pas
 * du recrutement (faux positif corrigé) — le mail est jugé sur le fond, 7/10 pour Cowork (problème générique).
 */
export const COWORK_SET_3: CoworkGradedMail[] = [
  {
    company: "WENABI",
    family: "F2",
    subject: "Candidatures associatives",
    core: "Bonjour,\n\nJe suis Axel Remillat, j'automatise les tâches répétitives des PME : je vous écris pour l'une des vôtres.\n\nVos programmes en 36 langues : une pièce manquante complique le suivi des candidatures d’associations.\n\nJ’automatise la lecture des candidatures et pièces reçues par e-mail, signale les manques et prépare la relance à valider.\n\nUne démo proche de ce que vous pourriez avoir chez vous : axelremillat.com/automatisations?demo=email&v=2\n\nAuriez-vous un créneau de 15 minutes la semaine prochaine pour voir si ça vous concerne ?",
    coworkReady: false,
    coworkScore: "7",
    note: "pas du recrutement ; problème générique (« une pièce manquante »)",
  },
];
