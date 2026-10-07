/**
 * TROIS ANNONCES UPWORK pour l'essai de bout en bout (plateformes #1).
 *
 * Upwork refuse toute lecture automatique de ses pages (HTTP 403, constaté le
 * 07/10/2026) et le scraping est exclu par ses CGU : le texte complet n'a pas
 * pu être copié. Ces annonces partent d'annonces PUBLIQUES RÉCENTES réelles
 * (titre, budget et sujet tels qu'indexés publiquement, URL citée) ; leur
 * description est RECONSTITUÉE dans le registre habituel des clients Upwork.
 * À remplacer par le texte copié à la main par Axel dès qu'il le colle.
 */
export interface UpworkAdFixture {
  title: string;
  url: string;
  budget: string;
  body: string;
  /** « reconstituée » tant qu'Axel n'a pas collé le texte exact. */
  provenance: "reconstituée" | "copiée";
}

export const UPWORK_ADS: UpworkAdFixture[] = [
  {
    title: "Simple AI lead qualification workflow in n8n",
    url: "https://www.upwork.com/freelance-jobs/n8n/",
    budget: "$800 fixed",
    provenance: "reconstituée",
    body: `We are a small B2B marketing agency. Leads come in through a Typeform on our website (about 150 per month) and land in a Google Sheet. Today someone on the team reads each one and decides if it is worth a call.

We want a simple n8n workflow that:
- triggers on each new Typeform submission
- uses OpenAI to score the lead (company size, budget, urgency) against our criteria
- writes the score and a one-line reason back to the Google Sheet
- sends hot leads to a Slack channel right away

We already have n8n cloud and an OpenAI key. Please include in your proposal how you would test the scoring and your timeline. Intermediate level, fixed price.`,
  },
  {
    title: "AI Automation Workflow Development with n8n for Lead Generation and CRM",
    url: "https://www.upwork.com/freelance-jobs/apply/Automation-Workflow-Development-with-n8n-for-Lead-Generation-and-CRM_~022049810091693040595/",
    budget: "$5 fixed (placeholder)",
    provenance: "reconstituée",
    body: `Looking for an n8n expert to build automation workflows for our lead generation and CRM.

Current setup: we collect leads from LinkedIn forms and our website contact form, then copy them by hand into HubSpot. Follow-up emails are sent manually and often forgotten.

What we need:
1. Capture leads from both sources into HubSpot automatically, with duplicates merged
2. Enrich each lead (company website, industry) and tag it
3. Start a short follow-up email sequence for new leads and stop it when they reply

Budget shown is a placeholder, please quote your real price. Tell us which similar workflows you have built.`,
  },
  {
    title: "AI-powered customer support and order management system using n8n",
    url: "https://www.upwork.com/freelance-jobs/n8n/",
    budget: "Hourly",
    provenance: "reconstituée",
    body: `We run an online shop on Shopify (around 40 orders a day) and receive 60 to 80 support emails daily in Gmail: order status, returns, address changes.

We want an AI assistant built with n8n that:
- reads incoming support emails and classifies them
- looks up the order in Shopify and drafts a reply with the real order status
- lets a team member approve the draft before it is sent
- logs every request in a Google Sheet for weekly reporting

Hourly contract, 10 to 20 hours per week at the start. Please describe your approach and your hourly rate.`,
  },
];
