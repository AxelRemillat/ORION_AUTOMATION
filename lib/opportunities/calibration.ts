import type { Language, Platform } from "./types";
import type { ProjectKind } from "./requests";

/**
 * JEU DE CALIBRAGE des propositions (05/10/2026) — écrit par l'agent, À FAIRE
 * VALIDER PAR AXEL (comme les mails : ses validations remplaceront ces
 * exemples). Positifs : le juge doit les noter 9 ou plus. Négatifs : sous 9.
 * Chaque positif passe aussi les règles du code (scripts/opportunites.test.ts).
 */

export interface ProposalReference {
  platform: Platform;
  language: Language;
  title: string;
  /** Annonce (résumé) et budget, pour le juge. */
  ad: string;
  budget: string | null;
  demo: "devis" | "emails" | "factures" | "reporting" | "fichier" | "sav" | "general";
  reading: string;
  steps: [string, string, string];
  framing: string;
  question: string;
  /** Réponse « références » quand l'annonce en demande. */
  references?: string;
  kind?: ProjectKind;
  amountEur?: number;
  delayDays?: number;
  /** Texte assemblé (sans lien ni signature) pour les exemples des prompts. */
  text: string;
  why?: string;
}

const compose = (item: Omit<ProposalReference, "text">): ProposalReference => ({
  ...item,
  text: [item.reading, item.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"), item.framing, item.references, item.question].filter(Boolean).join("\n\n"),
});

export const PROPOSAL_POSITIVES: ProposalReference[] = [
  // Cas RÉEL (06/10/2026) : « Crer des agent ia autonome » — version ORION écrite par Cowork (450 € / 7 j).
  compose({
    platform: "codeur",
    language: "fr",
    title: "Crer des agent ia autonome",
    ad: "Crer des agent ia autonome. Détails du projet : Des agent ia qui excute des taches de a a z. Détails des prestations attendues : Recherche de client envoie de mail creation facture et devis. Budget indicatif : Moins de 500 €.",
    budget: "Moins de 500 €",
    demo: "emails",
    kind: "automatisation",
    amountEur: 450,
    delayDays: 7,
    reading:
      "Vous voulez des agents IA qui trouvent des prospects, leur écrivent et préparent devis et factures. C'est ce que fait l'application que j'utilise chaque jour : elle repère des entreprises, vérifie leurs données, rédige des mails personnalisés et attend ma validation avant tout envoi.",
    steps: [
      "Recherche de prospects ciblés et rédaction des mails, envoi après votre validation.",
      "Préparation automatique des devis à partir de vos modèles.",
      "Test sur vos vrais cas et prise en main.",
    ],
    framing: "Pour votre budget, je propose un premier agent opérationnel en 7 jours. Prix : 450 €. Les factures pourront suivre dans un second temps.",
    question: "Quels sont votre secteur et vos outils actuels (mail, devis) ?",
  }),
  // Cas RÉEL (06/10/2026) : version reconstituée d'après la proposition d'Axel — 2 400 € / 15 j, références honnêtes.
  compose({
    platform: "codeur",
    language: "fr",
    title: "Agent IA : réponse automatique aux demandes de prix par mail (Sage 100)",
    ad: "Nous sommes distributeur de fournitures BTP. Nos clients nous envoient par mail des liens vers des produits vendus par nos concurrents, et nous demandent nos prix. Nous voulons automatiser ce traitement avec un agent IA : le commercial range le mail dans un dossier dédié ; l'agent en extrait les liens ; pour chaque lien, il récupère la référence fabricant sur la page (certains sites demandent une connexion avec un compte pro) ; il retrouve l'article dans Sage 100 Gestion commerciale (v12, SQL Server) et notre prix, idéalement le tarif du client ; il génère un Excel récapitulatif et prépare un brouillon de réponse. Contraintes : fonctionnement automatique avec signalement des erreurs, accès à Sage en lecture seule, hébergement et maintenance à prévoir. Merci d'indiquer dans votre devis : votre approche technique ; le prix du développement ; les coûts mensuels (hébergement, API IA, maintenance) ; le délai ; des références similaires (Sage, automatisation mail, IA).",
    budget: "1 000 € à 10 000 €",
    demo: "emails",
    kind: "automatisation",
    amountEur: 2400,
    delayDays: 15,
    reading:
      "Vous voulez qu'un agent IA traite les demandes de prix reçues par mail : références lues sur les pages concurrentes (compte pro compris), tarifs clients dans Sage 100 v12, Excel et brouillon.",
    steps: [
      "Lecture du dossier mail et extraction des liens, avec signalement des erreurs.",
      "Lecture des pages, connexion comprise, puis recherche dans Sage en lecture seule.",
      "Excel récapitulatif et brouillon de réponse, testés sur vos vraies demandes.",
    ],
    framing: "Prix : 2 400 €. Coûts mensuels : hébergement 15 €, API IA 10 à 30 € selon le volume, maintenance en option 90 €/mois. Délai : 15 jours.",
    references: "Pas encore de projet Sage 100 à vous montrer : voyez la démo ci-dessous et ORION, l'application d'automatisation mail + IA que j'utilise au quotidien.",
    question: "Combien de sites concurrents demandent un compte professionnel ?",
  }),
  compose({
    platform: "codeur",
    language: "fr",
    title: "Automatiser le tri des e-mails de commande (Gmail → Google Sheets)",
    ad: "PME de négoce, 60 à 80 e-mails de commande par jour sur Gmail, à recopier dans un Google Sheets (client, références, quantités, date souhaitée).",
    budget: "500 à 1 000 €",
    demo: "emails",
    reading:
      "Vous recevez 60 à 80 commandes par jour dans Gmail, et votre équipe recopie le client, les références, les quantités et la date dans un Google Sheets. Vous voulez que ces lignes se remplissent seules.",
    steps: [
      "Lecture automatique des e-mails de commande et des pièces jointes, avec extraction du client, des références, des quantités et de la date.",
      "Ajout d'une ligne par commande dans votre Google Sheets, et signalement des commandes incomplètes à vérifier.",
      "Une semaine d'essai sur vos vrais e-mails, réglages compris, puis une courte notice pour votre équipe.",
    ],
    framing: "Délai : environ deux semaines. Prix : 850 €, pour les formats de commande que vous recevez aujourd'hui.",
    question: "Vos commandes arrivent-elles surtout dans le corps du mail ou en pièce jointe PDF ?",
  }),
  compose({
    platform: "codeur",
    language: "fr",
    title: "Relances automatiques des factures impayées",
    ad: "Cabinet de services, factures émises sur Pennylane, relances faites à la main par la gérante, retards fréquents.",
    budget: null,
    demo: "factures",
    reading:
      "Vos factures partent de Pennylane, mais les relances des impayés sont faites à la main par la gérante, donc souvent en retard. Vous cherchez des relances qui partent au bon moment, avec le bon ton, sans y penser.",
    steps: [
      "Repérage chaque matin des factures échues dans Pennylane, avec le nombre de jours de retard.",
      "Préparation d'une relance adaptée au retard et à l'historique du client, envoyée après votre validation ou automatiquement.",
      "Un tableau simple des relances faites et des paiements reçus, pour suivre l'encaissement.",
    ],
    framing: "Pour chiffrer précisément, combien de factures émettez-vous par mois environ ? Le délai indicatif est de 10 jours.",
    question: "Souhaitez-vous valider chaque relance avant envoi, ou seulement les premières ?",
  }),
  compose({
    platform: "upwork",
    language: "en",
    title: "Build an AI assistant that answers customer questions from our PDFs",
    ad: "Small SaaS company, 40 PDF manuals, wants a chatbot on its website that answers support questions from the manuals and hands over to a human when unsure.",
    budget: "$1,500 fixed",
    demo: "sav",
    reading:
      "You have about 40 PDF manuals and want a chatbot on your website that answers support questions from them, and hands the conversation to your team when it is not sure. The goal is fewer repetitive tickets without wrong answers.",
    steps: [
      "Index the 40 manuals so each answer quotes the exact passage it comes from.",
      "Set up the chat widget on your site, with a clear handover to your support inbox when confidence is low.",
      "Test it with 30 real questions from your past tickets, then adjust before going live.",
    ],
    framing: "Timeline: about three weeks. Within your $1,500 budget, including one round of adjustments after launch.",
    question: "Which help desk do your support emails go to today, so the handover lands in the right place?",
  }),
  compose({
    platform: "upwork",
    language: "en",
    title: "Clean and deduplicate our customer CSV before CRM migration",
    ad: "Retailer migrating to HubSpot, 25,000 customer rows in several CSV exports with duplicates, inconsistent phone formats and missing countries.",
    budget: null,
    demo: "fichier",
    reading:
      "Before moving to HubSpot, you need to merge several CSV exports of about 25,000 customers that contain duplicates, phone numbers in different formats and missing countries. You want one clean file you can import without fixing it by hand.",
    steps: [
      "Merge the exports and detect duplicates on name, email and phone, with a list of uncertain cases for you to decide.",
      "Standardise phone numbers and fill in missing countries from postal codes where possible.",
      "Deliver a HubSpot-ready CSV and a short report of every change made.",
    ],
    framing: "To give you a firm price, how many separate exports are there, and do any include company accounts? Indicative timeline: one week.",
    question: "When two records conflict, which source should win: the most recent one or a specific system?",
  }),
];

export const PROPOSAL_NEGATIVES: ProposalReference[] = [
  // Cas RÉEL (06/10/2026) : proposition générée — pas de « Bonjour », prix du texte (400 à 480 €) ≠ champ (450 €), démo hors sujet.
  compose({
    platform: "codeur",
    language: "fr",
    title: "Crer des agent ia autonome",
    ad: "Crer des agent ia autonome. Détails du projet : Des agent ia qui excute des taches de a a z. Détails des prestations attendues : Recherche de client envoie de mail creation facture et devis. Budget indicatif : Moins de 500 €.",
    budget: "Moins de 500 €",
    demo: "emails",
    kind: "automatisation",
    amountEur: 450,
    delayDays: 7,
    reading:
      "Vous souhaitez des agents IA capables d'enchaîner la recherche de prospects, l'envoi d'e-mails et la création de devis et factures. Les outils utilisés et les validations nécessaires avant chaque envoi restent à préciser.",
    steps: [
      "Définir avec vous les sources de prospects, les modèles de documents et les actions à valider.",
      "Créer un premier parcours automatisé avec vos outils existants et un contrôle avant tout envoi.",
      "Tester ce parcours sur quelques cas réels, corriger les erreurs et documenter son utilisation.",
    ],
    framing: "Sous 500 €, je propose un premier parcours ciblé en 5 à 7 jours, pour 400 à 480 € ; l'ensemble nécessiterait un devis distinct.",
    question: "Quels outils utilisez-vous actuellement pour vos e-mails, devis et factures ?",
    why: "Prix du texte (400 à 480 €) différent du montant à saisir (450 €), fourchette, délai flou, reformulation qui renvoie le flou au client, démo « tri des e-mails » au lieu d'ORION.",
  }),
  // Cas RÉEL (06/10/2026) : proposition générée sur l'annonce complète, notée 9 par le juge, ~7 en réalité.
  compose({
    platform: "codeur",
    language: "fr",
    title: "Agent IA : réponse automatique aux demandes de prix par mail (Sage 100)",
    ad: "Nous sommes distributeur de fournitures BTP. Nos clients nous envoient par mail des liens vers des produits vendus par nos concurrents, et nous demandent nos prix. Nous voulons automatiser ce traitement avec un agent IA : le commercial range le mail dans un dossier dédié ; l'agent en extrait les liens ; pour chaque lien, il récupère la référence fabricant sur la page (certains sites demandent une connexion avec un compte pro) ; il retrouve l'article dans Sage 100 Gestion commerciale (v12, SQL Server) et notre prix, idéalement le tarif du client ; il génère un Excel récapitulatif et prépare un brouillon de réponse. Contraintes : fonctionnement automatique avec signalement des erreurs, accès à Sage en lecture seule, hébergement et maintenance à prévoir. Merci d'indiquer dans votre devis : votre approche technique ; le prix du développement ; les coûts mensuels (hébergement, API IA, maintenance) ; le délai ; des références similaires (Sage, automatisation mail, IA).",
    budget: "1 000 € à 10 000 €",
    demo: "devis",
    kind: "automatisation",
    reading:
      "Vous souhaitez traiter automatiquement les mails contenant des liens vers des fournitures BTP concurrentes, retrouver les références et tarifs clients dans Sage 100 v12, puis préparer un Excel et un brouillon, sans envoyer le mail.",
    steps: [
      "Surveiller le dossier mail et extraire les liens, avec signalement des erreurs de lecture.",
      "Lire les pages, y compris avec connexion, puis rapprocher les références dans Sage via SQL Server sécurisé.",
      "Produire l'Excel et le brouillon, puis tester les tarifs clients et les cas introuvables.",
    ],
    framing: "Délai : 4 à 6 semaines. Développement : 4 000 à 6 000 €, selon les sites et accès Sage ; hébergement, API et maintenance : 100 à 250 €/mois estimés.",
    question: "Combien de sites concurrents faut-il couvrir, et combien nécessitent un compte professionnel ?",
    why: "Fourchette de prix hors positionnement (4 000 à 6 000 €), délai trop long (4 à 6 semaines), coûts mensuels irréalistes (100 à 250 €/mois), références demandées sans réponse.",
  }),
  compose({
    platform: "codeur",
    language: "fr",
    title: "Automatiser le tri des e-mails de commande (Gmail → Google Sheets)",
    ad: "60 à 80 e-mails de commande par jour sur Gmail à recopier dans un Google Sheets.",
    budget: "500 à 1 000 €",
    demo: "emails",
    reading:
      "Vous recevez 60 à 80 commandes par jour dans Gmail et votre équipe recopie le client, les références et les quantités dans un Google Sheets. Vous voulez que ces lignes se remplissent seules.",
    steps: [
      "Lecture des e-mails de commande et extraction du client, des références, des quantités et de la date.",
      "Ajout d'une ligne par commande dans votre Google Sheets, avec signalement des commandes incomplètes.",
      "Une semaine d'essai sur vos vrais e-mails, puis une courte notice pour votre équipe.",
    ],
    framing: "Délai : deux semaines, entre 700 et 950 €. Voyez un exemple sur axelremillat.com/automatisations ou écrivez-moi à axel@axelremillat.com.",
    question: "Vos commandes arrivent-elles surtout dans le corps du mail ou en pièce jointe PDF ?",
    why: "Codeur : URL et adresse e-mail dans la proposition — interdit par la plateforme (risque de suppression du compte).",
  }),
  compose({
    platform: "codeur",
    language: "fr",
    title: "Automatiser le tri des e-mails de commande",
    ad: "60 à 80 e-mails de commande par jour sur Gmail à recopier dans un Google Sheets.",
    budget: "500 à 1 000 €",
    demo: "emails",
    reading: "Super projet ! J'ai bien lu votre annonce et je suis la personne qu'il vous faut pour automatiser vos tâches.",
    steps: ["Analyse de votre besoin.", "Mise en place de la solution.", "Livraison et suivi."],
    framing: "Délai : rapide. Prix : à discuter.",
    question: "Quand pouvons-nous en parler ?",
    why: "Flatterie et reformulation générique : rien ne montre que l'annonce a été lue ; étapes creuses.",
  }),
  compose({
    platform: "codeur",
    language: "fr",
    title: "Relances automatiques des factures impayées",
    ad: "Factures sur Pennylane, relances à la main.",
    budget: null,
    demo: "factures",
    reading: "Vos relances de factures sont faites à la main. J'ai déjà aidé plus de 30 PME à réduire leurs impayés de 40 %.",
    steps: ["Connexion à Pennylane.", "Relances automatiques.", "Tableau de bord."],
    framing: "Prix : 800 €, délai une semaine.",
    question: "On commence quand ?",
    why: "Expérience et résultats inventés (« 30 PME », « 40 % »), prix posé alors que le budget n'est pas donné.",
  }),
  compose({
    platform: "upwork",
    language: "en",
    title: "AI assistant for our PDFs",
    ad: "Chatbot answering support questions from 40 PDF manuals.",
    budget: "$1,500 fixed",
    demo: "sav",
    reading: "I will leverage cutting-edge AI to build a seamless, end-to-end solution for your business.",
    steps: ["Leverage LLMs.", "Build a robust pipeline.", "Deploy a state-of-the-art workflow."],
    framing: "Price: $1,500.",
    question: "Shall we start?",
    why: "Jargon (leverage, seamless, pipeline), aucun élément concret de l'annonce, étapes vides.",
  }),
  compose({
    platform: "upwork",
    language: "en",
    title: "Clean our customer CSV",
    ad: "25,000 customer rows with duplicates before HubSpot migration.",
    budget: null,
    demo: "fichier",
    reading: "You need to clean a CSV file before a migration.",
    steps: [
      "Clean the file.",
      "Remove duplicates.",
      "Send it back.",
    ],
    framing: "It should be quick.",
    question: "Is that okay?",
    why: "Reformulation vague (ni HubSpot, ni volume, ni formats), étapes non concrètes, aucune question de cadrage utile.",
  }),
];
