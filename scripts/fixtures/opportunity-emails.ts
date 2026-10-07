/**
 * E-mails de plateformes RÉALISTES mais FICTIFS (plateformes #1) : structure,
 * expéditeurs et sujets calqués sur les notifications d'Upwork, Malt et
 * ComeUp ; noms, identifiants et montants inventés. Aucune donnée réelle.
 * Axel transmettra de vrais exemples : ils compléteront cette liste.
 */
import type { InboundEmail } from "../../lib/opportunities/email/parse";

export interface EmailFixture {
  name: string;
  email: InboundEmail;
  expect: { platform: string | null; kind: string; title?: string; externalId?: string | null; client?: string | null; budget?: string | null; amountEur?: number | null; jobs?: number };
}

const FOOTER_UPWORK = "\n\nYou are receiving this email because of your notification settings.\nManage email notifications: https://www.upwork.com/nx/notification-settings\nUpwork Global Inc., 530 Lytton Avenue, Palo Alto, CA";
const FOOTER_MALT = "\n\nGérer mes notifications : https://www.malt.fr/settings/notifications\nMalt Community SAS — 75009 Paris";
const FOOTER_COMEUP = "\n\nSe désinscrire : https://comeup.com/fr/account/notifications\nComeUp SAS";

const at = (iso: string) => iso;

export const EMAIL_FIXTURES: EmailFixture[] = [
  {
    name: "Upwork — invitation à postuler",
    email: {
      message_id: "<inv-0001@upwork.com>",
      from: "Upwork <donotreply@upwork.com>",
      subject: 'You have been invited to interview for "Build an n8n workflow to sync Shopify orders with Airtable"',
      text:
        "Hi Axel,\n\nJordan K. has invited you to interview for the following job:\n\nBuild an n8n workflow to sync Shopify orders with Airtable\nhttps://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9?source=invite\n\nHourly: $30-$50\n\nWe run a small Shopify store (about 60 orders a day). Every order must be copied into our Airtable base with the customer, items and shipping status, and updated when it ships. Looking for someone who already used n8n.\n\nView invitation: https://www.upwork.com/ab/proposals/interview/1823746" +
        FOOTER_UPWORK,
      html: "",
      received_at: at("2026-10-07T08:12:00Z"),
    },
    expect: { platform: "upwork", kind: "invitation", title: "Build an n8n workflow to sync Shopify orders with Airtable", externalId: "~01a2b3c4d5e6f7a8b9", client: "Jordan K.", budget: "$30-$50" },
  },
  {
    name: "Upwork — nouveau message sur cette annonce",
    email: {
      message_id: "<msg-0002@upwork.com>",
      from: "Upwork Messages <messages@upwork.com>",
      subject: 'New message from Jordan K. about "Build an n8n workflow to sync Shopify orders with Airtable"',
      text: "Jordan K. sent you a message:\n\n\"Thanks Axel, your plan looks right. Can you start on Monday?\"\n\nReply: https://www.upwork.com/ab/messages/rooms/room_8a7b6c5d4e" + FOOTER_UPWORK,
      html: "",
      received_at: at("2026-10-07T10:40:00Z"),
    },
    expect: { platform: "upwork", kind: "message", title: "Build an n8n workflow to sync Shopify orders with Airtable", client: "Jordan K." },
  },
  {
    name: "Upwork — offre reçue",
    email: {
      message_id: "<offer-0003@upwork.com>",
      from: "Upwork <donotreply@upwork.com>",
      subject: 'Jordan K. sent you an offer: "Build an n8n workflow to sync Shopify orders with Airtable"',
      text: "You received an offer.\n\nContract: Build an n8n workflow to sync Shopify orders with Airtable\nRate: $40.00/hr\n\nReview offer: https://www.upwork.com/ab/offers/offer/48120933" + FOOTER_UPWORK,
      html: "",
      received_at: at("2026-10-08T09:00:00Z"),
    },
    expect: { platform: "upwork", kind: "offre", client: "Jordan K." },
  },
  {
    name: "Upwork — contrat démarré",
    email: {
      message_id: "<contract-0004@upwork.com>",
      from: "Upwork <donotreply@upwork.com>",
      subject: 'Your contract has started: "Build an n8n workflow to sync Shopify orders with Airtable"',
      text: "Congratulations! Your contract with Jordan K. has started.\n\nView contract: https://www.upwork.com/ab/contracts/38409912" + FOOTER_UPWORK,
      html: "",
      received_at: at("2026-10-08T15:00:00Z"),
    },
    expect: { platform: "upwork", kind: "gagnee" },
  },
  {
    name: "Upwork — proposition refusée (annonce inconnue d'ORION)",
    email: {
      message_id: "<declined-0005@upwork.com>",
      from: "Upwork <donotreply@upwork.com>",
      subject: 'Your proposal was declined: "AI chatbot for a real estate agency website"',
      text: "The client has declined your proposal for AI chatbot for a real estate agency website.\n\nFind more jobs: https://www.upwork.com/nx/find-work/" + FOOTER_UPWORK,
      html: "",
      received_at: at("2026-10-07T07:00:00Z"),
    },
    expect: { platform: "upwork", kind: "perdue" },
  },
  {
    name: "Upwork — recommandations (liens de suivi encodés, HTML)",
    email: {
      message_id: "<reco-0006@upwork.com>",
      from: "Upwork <jobs-noreply@upwork.com>",
      subject: "Jobs recommended for you",
      text: "",
      html:
        '<html><head><style>.x{color:red}</style></head><body><h2>Jobs recommended for you</h2>' +
        '<table><tr><td><a href="https://click.upwork.com/f/a/Xyz?url=https%3A%2F%2Fwww.upwork.com%2Fjobs%2F~01ff00aa11bb22cc33%3Fsource%3Drss">Automate invoice extraction from PDF to QuickBooks</a></td></tr>' +
        "<tr><td>Fixed-price: $400 &middot; We receive 200 supplier invoices a month as PDF and want them read and pushed to QuickBooks Online automatically.</td></tr>" +
        '<tr><td><a href="https://click.upwork.com/f/a/Abc?url=https%3A%2F%2Fwww.upwork.com%2Fjobs%2FAI-email-assistant_~01dd44ee55ff66aa77">AI email triage assistant for Gmail (support inbox)</a></td></tr>' +
        "<tr><td>Hourly: $25-$45 &middot; Classify incoming support emails and draft replies for review.</td></tr>" +
        '<tr><td><a href="https://www.upwork.com/jobs/~01dd44ee55ff66aa77">View job</a></td></tr>' +
        '<tr><td><a href="https://www.upwork.com/nx/find-work/">See more jobs</a></td></tr></table>' +
        '<p>Manage email notifications</p></body></html>',
      received_at: at("2026-10-07T06:00:00Z"),
    },
    expect: { platform: "upwork", kind: "recommandation", jobs: 2 },
  },
  {
    name: "Upwork — résumé hebdomadaire (non reconnu)",
    email: {
      message_id: "<weekly-0007@upwork.com>",
      from: "Upwork <donotreply@upwork.com>",
      subject: "Your weekly Connects summary",
      text: "You have 42 Connects available. Buy more Connects: https://www.upwork.com/nx/plans/connects" + FOOTER_UPWORK,
      html: "",
      received_at: at("2026-10-07T05:00:00Z"),
    },
    expect: { platform: "upwork", kind: "autre" },
  },
  {
    name: "Upwork — message d'un client sur une annonce inconnue d'ORION",
    email: {
      message_id: "<msg-0008@upwork.com>",
      from: "Upwork Messages <messages@upwork.com>",
      subject: 'New message from Priya S. about "Zapier to Make migration for 12 scenarios"',
      text: "Priya S. sent you a message:\n\n\"Hi Axel, thanks for your proposal. Could you share how you would test the migrated scenarios?\"\n\nReply: https://www.upwork.com/ab/messages/rooms/room_1f2e3d4c" + FOOTER_UPWORK,
      html: "",
      received_at: at("2026-10-07T12:00:00Z"),
    },
    expect: { platform: "upwork", kind: "message", client: "Priya S." },
  },
  {
    name: "Malt — nouvelle demande de projet",
    email: {
      message_id: "<malt-0009@malt.fr>",
      from: "Malt <noreply@malt.fr>",
      subject: "Nouvelle demande de projet de Claire Fontaine",
      text:
        "Bonjour Axel,\n\nClaire Fontaine (Atelier Fontaine) souhaite vous confier un projet.\n\nProjet : Automatiser la saisie des bons de commande dans notre ERP\nBudget : 1 500 €\nDurée estimée : 3 semaines\n\nNous recevons une trentaine de bons de commande par jour en PDF, ressaisis à la main dans Sage. Nous voudrions les lire automatiquement et les intégrer après validation.\n\nRépondre à Claire : https://www.malt.fr/messages/client-project/6650aa11bb22cc33dd44ee55?utm_source=email" +
        FOOTER_MALT,
      html: "",
      received_at: at("2026-10-07T09:30:00Z"),
    },
    expect: { platform: "malt", kind: "demande", title: "Automatiser la saisie des bons de commande dans notre ERP", externalId: "malt:6650aa11bb22cc33dd44ee55", client: "Claire Fontaine", budget: "1 500 €" },
  },
  {
    name: "Malt — nouveau message du même client",
    email: {
      message_id: "<malt-0010@malt.fr>",
      from: "Malt <noreply@malt.fr>",
      subject: "Nouveau message de Claire Fontaine",
      text: "Bonjour Axel,\n\nClaire Fontaine vous a envoyé un message :\n« Merci pour votre réponse. Pouvons-nous échanger jeudi ? »\n\nVoir la conversation : https://www.malt.fr/messages/client-project/6650aa11bb22cc33dd44ee55" + FOOTER_MALT,
      html: "",
      received_at: at("2026-10-07T16:00:00Z"),
    },
    expect: { platform: "malt", kind: "message", client: "Claire Fontaine", externalId: "malt:6650aa11bb22cc33dd44ee55" },
  },
  {
    name: "Malt — devis accepté",
    email: {
      message_id: "<malt-0011@malt.fr>",
      from: "Malt <noreply@malt.fr>",
      subject: "Claire Fontaine a accepté votre devis",
      text: "Bonne nouvelle !\n\nClaire Fontaine a accepté votre devis pour le projet « Automatiser la saisie des bons de commande dans notre ERP ».\n\nVoir le projet : https://www.malt.fr/messages/client-project/6650aa11bb22cc33dd44ee55" + FOOTER_MALT,
      html: "",
      received_at: at("2026-10-09T10:00:00Z"),
    },
    expect: { platform: "malt", kind: "gagnee", client: "Claire Fontaine" },
  },
  {
    name: "Malt — message d'un client inconnu (= nouvelle demande)",
    email: {
      message_id: "<malt-0012@malt.com>",
      from: "Malt <notifications@malt.com>",
      subject: "Nouveau message de Thomas Garnier",
      text: "Bonjour Axel,\n\nThomas Garnier vous a envoyé un message :\n« Bonjour, nous cherchons quelqu'un pour connecter notre CRM HubSpot à notre outil de facturation. Êtes-vous disponible en novembre ? »\n\nRépondre : https://www.malt.fr/messages/client-project/77aa88bb99cc00dd11ee22ff" + FOOTER_MALT,
      html: "",
      received_at: at("2026-10-07T11:00:00Z"),
    },
    expect: { platform: "malt", kind: "message", client: "Thomas Garnier" },
  },
  {
    name: "ComeUp — nouvelle commande",
    email: {
      message_id: "<comeup-0013@comeup.com>",
      from: "ComeUp <notifications@comeup.com>",
      subject: "Nouvelle commande n°48213 : Je crée votre chatbot IA sur vos documents",
      text: "Bonjour Axel,\n\nBonne nouvelle ! Sophie M. a commandé votre service.\n\nService : Je crée votre chatbot IA sur vos documents\nMontant : 120 €\nCommande n°48213\n\nVoir la commande : https://comeup.com/fr/orders/48213" + FOOTER_COMEUP,
      html: "",
      received_at: at("2026-10-07T13:00:00Z"),
    },
    expect: { platform: "comeup", kind: "commande", title: "Je crée votre chatbot IA sur vos documents", externalId: "comeup:48213", client: "Sophie M.", amountEur: 120 },
  },
  {
    name: "ComeUp — demande personnalisée",
    email: {
      message_id: "<comeup-0014@comeup.com>",
      from: "ComeUp <notifications@comeup.com>",
      subject: "Nouvelle demande personnalisée de Marc Leroy",
      text: "Bonjour Axel,\n\nMarc Leroy souhaite vous commander une prestation sur mesure :\n« J'ai besoin d'un tri automatique des mails de mon cabinet comptable (Outlook, 150 mails par jour). Quel serait votre prix ? »\n\nRépondre : https://comeup.com/fr/conversations/990011" + FOOTER_COMEUP,
      html: "",
      received_at: at("2026-10-07T14:00:00Z"),
    },
    expect: { platform: "comeup", kind: "demande", client: "Marc Leroy", externalId: "comeup:990011" },
  },
  {
    name: "ComeUp — message du client de la commande",
    email: {
      message_id: "<comeup-0015@comeup.com>",
      from: "ComeUp <notifications@comeup.com>",
      subject: "Nouveau message de Sophie M.",
      text: "Sophie M. vous a envoyé un message concernant la commande n°48213 :\n« Voici nos 12 documents PDF. »\n\nVoir la commande : https://comeup.com/fr/orders/48213" + FOOTER_COMEUP,
      html: "",
      received_at: at("2026-10-07T18:00:00Z"),
    },
    expect: { platform: "comeup", kind: "message", client: "Sophie M.", externalId: "comeup:48213" },
  },
  {
    name: "Expéditeur inconnu (newsletter)",
    email: {
      message_id: "<news-0016@makenotion.com>",
      from: "Notion <team@makenotion.com>",
      subject: "What's new in Notion this month",
      text: "Here are the latest features in Notion: AI meeting notes, charts and more. Unsubscribe here.",
      html: "",
      received_at: at("2026-10-07T07:30:00Z"),
    },
    expect: { platform: null, kind: "autre" },
  },
];

/**
 * Codeur (plateformes #6) — e-mails de SUIVI d'un projet connu par le flux RSS.
 * Fictifs : projet 490123, client « Société Martin », montants inventés.
 */
const FOOTER_CODEUR = "\n\nVous recevez cet e-mail car vous avez répondu à ce projet sur Codeur.com.\nGérer mes notifications : https://www.codeur.com/users/notifications\nCodeur.com SAS";

export const CODEUR_EMAIL_FIXTURES: EmailFixture[] = [
  {
    name: "Codeur — message du client",
    email: {
      message_id: "<codeur-msg-0001@codeur.com>",
      from: "Codeur.com <notifications@codeur.com>",
      subject: "Nouveau message de Société Martin sur le projet « Automatiser le tri de nos e-mails de commande »",
      text: "Bonjour Axel,\n\nSociété Martin vous a envoyé un message concernant le projet « Automatiser le tri de nos e-mails de commande » :\n« Bonjour, votre approche nous intéresse. Pouvez-vous démarrer lundi ? »\n\nRépondre : https://www.codeur.com/projects/490123-automatiser-le-tri-de-nos-e-mails-de-commande/messages?utm_source=email" + FOOTER_CODEUR,
      html: "",
      received_at: "2026-10-07T09:00:00Z",
    },
    expect: { platform: "codeur", kind: "message", externalId: "490123", client: "Société Martin" },
  },
  {
    name: "Codeur — projet attribué",
    email: {
      message_id: "<codeur-win-0002@codeur.com>",
      from: "Codeur.com <notifications@codeur.com>",
      subject: "Le projet « Automatiser le tri de nos e-mails de commande » vous a été attribué",
      text: "Félicitations !\n\nSociété Martin vous a attribué le projet « Automatiser le tri de nos e-mails de commande ».\n\nVoir le projet : https://www.codeur.com/projects/490123-automatiser-le-tri-de-nos-e-mails-de-commande" + FOOTER_CODEUR,
      html: "",
      received_at: "2026-10-08T10:00:00Z",
    },
    expect: { platform: "codeur", kind: "gagnee", externalId: "490123" },
  },
  {
    name: "Codeur — offre non retenue",
    email: {
      message_id: "<codeur-lost-0003@codeur.com>",
      from: "Codeur.com <notifications@codeur.com>",
      subject: "Votre offre n'a pas été retenue pour le projet « Chatbot pour notre site immobilier »",
      text: "Bonjour,\n\nLe client a choisi un autre prestataire pour le projet « Chatbot pour notre site immobilier ».\n\nVoir le projet : https://www.codeur.com/projects/490456-chatbot-pour-notre-site-immobilier" + FOOTER_CODEUR,
      html: "",
      received_at: "2026-10-07T11:00:00Z",
    },
    expect: { platform: "codeur", kind: "perdue", externalId: "490456" },
  },
  {
    name: "Codeur — projet clos",
    email: {
      message_id: "<codeur-closed-0004@codeur.com>",
      from: "Codeur.com <notifications@codeur.com>",
      subject: "Le projet « Extraction de factures PDF vers Excel » a été fermé",
      text: "Bonjour,\n\nLe projet « Extraction de factures PDF vers Excel » a été fermé par son auteur.\n\nhttps://www.codeur.com/projects/490789-extraction-de-factures-pdf-vers-excel" + FOOTER_CODEUR,
      html: "",
      received_at: "2026-10-07T12:00:00Z",
    },
    expect: { platform: "codeur", kind: "perdue", externalId: "490789" },
  },
  {
    name: "Codeur — message sur un projet inconnu d'ORION",
    email: {
      message_id: "<codeur-msg-0005@codeur.com>",
      from: "Codeur.com <notifications@codeur.com>",
      subject: "Nouveau message de Paul D. sur le projet « Site vitrine pour boulangerie »",
      text: "Paul D. vous a envoyé un message.\n\nRépondre : https://www.codeur.com/projects/400001-site-vitrine-pour-boulangerie/messages" + FOOTER_CODEUR,
      html: "",
      received_at: "2026-10-07T13:00:00Z",
    },
    expect: { platform: "codeur", kind: "message", externalId: "400001" },
  },
];

/**
 * Codeur « Nouveau projet » (plateformes #7) — l'alerte e-mail qui double le flux RSS
 * (expéditeur notification@compte.codeur.com). Fictifs : projets 490913, 491020, 491021.
 */
const codeurProject = (id: string, slug: string, title: string, budget: string, excerpt: string, minute: number): InboundEmail => ({
  message_id: `<codeur-projet-${id}@compte.codeur.com>`,
  from: "Codeur.com <notification@compte.codeur.com>",
  subject: `Nouveau projet : ${title}`,
  text: `Bonjour Axel,\n\nUn nouveau projet correspondant à vos compétences vient d'être publié :\n\n${title}\nBudget : ${budget}\n\n${excerpt}\n\nVoir le projet : https://www.codeur.com/projects/${id}-${slug}?utm_source=alerte&utm_medium=email` + FOOTER_CODEUR,
  html: "",
  received_at: `2026-10-07T17:${String(minute).padStart(2, "0")}:00Z`,
});

export const CODEUR_PROJECT_FIXTURES: { name: string; email: InboundEmail; externalId: string }[] = [
  {
    name: "connu (déjà reçu par le flux RSS)",
    externalId: "490913",
    email: codeurProject("490913", "recherche-developpeur", "Recherche développeur", "500 € à 1 000 €", "Nous cherchons un développeur pour automatiser l'envoi de nos devis depuis notre CRM…", 38),
  },
  {
    name: "inconnu, pertinent (automatisation)",
    externalId: "491020",
    email: codeurProject("491020", "automatiser-la-saisie-de-nos-factures-fournisseurs", "Automatiser la saisie de nos factures fournisseurs", "1 000 € à 2 000 €", "Nous recevons environ 150 factures PDF par mois par e-mail, saisies à la main dans Pennylane. Nous voulons les extraire et les importer automatiquement…", 41),
  },
  {
    name: "inconnu, hors cible (site WordPress)",
    externalId: "491021",
    email: codeurProject("491021", "refonte-de-notre-site-wordpress", "Refonte de notre site WordPress", "500 € à 1 000 €", "Refonte d'un site vitrine WordPress de 8 pages avec un nouveau thème et un blog…", 44),
  },
];
