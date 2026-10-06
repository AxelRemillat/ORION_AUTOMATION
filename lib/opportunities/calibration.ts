import type { Language, Platform } from "./types";

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
  /** Texte assemblé (sans lien ni signature) pour les exemples des prompts. */
  text: string;
  why?: string;
}

const compose = (item: Omit<ProposalReference, "text">): ProposalReference => ({
  ...item,
  text: [item.reading, item.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"), item.framing, item.question].join("\n\n"),
});

export const PROPOSAL_POSITIVES: ProposalReference[] = [
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
    framing: "Délai : environ deux semaines. Budget : entre 700 et 950 € selon le nombre de formats de commande différents.",
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
    framing: "Pour chiffrer précisément, combien de factures émettez-vous par mois environ ? Le délai indicatif est d'une à deux semaines.",
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
