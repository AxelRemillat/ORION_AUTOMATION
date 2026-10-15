import type { UpworkAdFixture } from "./upwork-ads";

/**
 * CINQ ANNONCES UPWORK RÉALISTES (Cowork #63) — écrites pour l'essai, sur le modèle des annonces publiques en IA /
 * automatisation : aucune n'est une vraie annonce copiée, aucun client réel. `npm run eval:upwork -- --set 63`.
 */
export const UPWORK_ADS_63: UpworkAdFixture[] = [
  {
    title: "n8n workflow: new Typeform leads to HubSpot + Slack alert",
    url: "fixture",
    budget: "$300 fixed",
    body: "We run a small marketing agency. Every lead from our Typeform contact form should be created as a contact in HubSpot (with deal stage 'New'), and our sales channel in Slack should get a short alert with the lead's name, budget and service. Duplicates must be avoided (same email = update, not create). We already self-host n8n on a VPS. Please describe how you'd build it and how long it takes.",
  },
  {
    title: "OpenAI chatbot for our website answering questions from our FAQ and product PDFs",
    url: "fixture",
    budget: "$25.00-$45.00 /hr",
    body: "We sell outdoor furniture online (Shopify). We get the same questions every day: delivery times, materials, care instructions, warranty. We have a FAQ page and about 30 product PDFs. We want a chatbot on the website, powered by OpenAI, that answers from these documents only and hands over to a human (email to support) when it doesn't know. Must work in English and French. Show examples of similar chatbots you built.",
  },
  {
    title: "Migrate 12 Zapier zaps to Make (or n8n) to cut costs",
    url: "fixture",
    budget: "$600 fixed",
    body: "Our Zapier bill is getting too high. We have 12 zaps: Gmail to Google Sheets, Stripe payments to QuickBooks, Calendly bookings to Pipedrive, and a few Slack notifications. We'd like to move everything to Make (or n8n if you can justify it), keep the same behaviour, and document each scenario. Zero downtime please. What would you recommend and what's your price?",
  },
  {
    title: "AI agent to triage our support inbox (Gmail) and draft replies",
    url: "fixture",
    budget: "$800 fixed",
    body: "We're a SaaS with ~120 support emails a day in a shared Gmail inbox. We want an AI agent that labels each email (billing, bug, feature request, account access), drafts a reply for the simple ones using our help center, and escalates urgent ones (outage, payment failed) to Slack. Nothing should be sent automatically — a human approves every reply. Tell us your approach and timeline.",
  },
  {
    title: "Extract data from supplier PDF invoices into Google Sheets",
    url: "fixture",
    budget: "$250 fixed",
    body: "We receive around 200 supplier invoices per month as PDF attachments by email (different layouts, some scanned). We need invoice number, date, supplier, total excl. VAT, VAT and due date extracted into a Google Sheet, with a flag when something can't be read. Ideally it runs automatically when a new invoice arrives. How accurate can you get on scanned invoices?",
  },
  {
    // Cowork #66 : doit citer le projet ORION, SANS lien de démo.
    title: "Build a lead generation pipeline that finds and scores B2B prospects",
    url: "fixture",
    budget: "$500 fixed",
    body: "We sell maintenance software to manufacturing SMEs in France and Belgium. We need a lead generation pipeline that finds relevant B2B prospects (company size, sector, region), enriches them with a decision-maker contact, scores them against our ideal customer profile, and prepares a short first email for each that our sales rep approves before anything is sent. Output to our CRM (Pipedrive). How would you build it, and how do you keep the outreach compliant?",
  },
  {
    // Cowork #68 : doit citer « AI Quote Agent », avec sa démo /en/agent.
    title: "AI agent that answers customer quote requests from our catalog",
    url: "fixture",
    budget: "$400 fixed",
    body: "We distribute industrial fasteners (about 3,000 references in a Google Sheet catalog with prices and stock). Customers email us quote requests: product names, quantities, sometimes a photo of a part. We want an AI agent that finds the matching references in our catalog, computes the price with our volume discounts, and drafts a priced quote reply that our sales team checks before sending. Unclear requests should get a follow-up question instead of a guess. What approach would you take?",
  },
];
