/**
 * TROIS ANNONCES UPWORK pour l'essai de bout en bout (`npm run eval:upwork`).
 *
 * Upwork refuse toute lecture automatique (HTTP 403) et le scraping est exclu
 * par ses CGU : le texte d'une annonce se COPIE À LA MAIN. Les titres, liens et
 * budgets ci-dessous viennent d'annonces publiques récentes en IA /
 * automatisation ; le texte est à coller par Axel à la place du marqueur.
 * Tant que le marqueur est là, `eval:upwork` saute l'annonce. Aucun test ne
 * dépend de ce contenu.
 */
export const TO_REPLACE = "À REMPLACER PAR UN TEXTE COPIÉ À LA MAIN";

export interface UpworkAdFixture {
  title: string;
  url: string;
  budget: string;
  body: string;
}

export const UPWORK_ADS: UpworkAdFixture[] = [
  { title: "Simple AI lead qualification workflow in n8n", url: "https://www.upwork.com/freelance-jobs/n8n/", budget: "$800 fixed", body: TO_REPLACE },
  {
    title: "AI Automation Workflow Development with n8n for Lead Generation and CRM",
    url: "https://www.upwork.com/freelance-jobs/apply/Automation-Workflow-Development-with-n8n-for-Lead-Generation-and-CRM_~022049810091693040595/",
    budget: "$5 fixed (placeholder)",
    body: TO_REPLACE,
  },
  { title: "AI-powered customer support and order management system using n8n", url: "https://www.upwork.com/freelance-jobs/n8n/", budget: "Hourly", body: TO_REPLACE },
];

/** Annonce encore à coller : le marqueur est toujours là (ou le texte est trop court pour être une annonce). */
export const isPlaceholder = (ad: UpworkAdFixture) => ad.body.includes(TO_REPLACE) || ad.body.trim().length < 80;
