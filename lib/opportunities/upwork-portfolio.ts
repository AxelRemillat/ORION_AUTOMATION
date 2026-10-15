/**
 * PORTFOLIO UPWORK D'AXEL — titres EXACTS tels qu'ils apparaissent sur son profil (Cowork #64, 15/10 14 h 30).
 *
 * SOURCE UNIQUE : une proposition Upwork ne cite QUE ces projets, et seulement ceux où `publie` vaut `true` — un
 * client qui clique sur le portfolio doit trouver le projet annoncé. Axel passe `publie` à `true` quand il publie.
 * Chaque projet porte son lien de démo anglais (suivi `ref=upwork`, lu par le portfolio) et les besoins qu'il couvre.
 */

export interface UpworkPortfolioProject {
  id: "email-triage" | "invoice-extraction" | "rag-chatbot" | "lead-generation" | "quote-agent";
  titre: string;
  /** Lien de démo anglais, sans protocole, avec `ref=upwork` ; `null` = projet privé, cité sans démo (ORION). */
  lien: string | null;
  /** Besoins couverts (lus dans l'annonce). */
  usages: RegExp;
  /** Besoins pour lesquels ce projet n'est JAMAIS cité, même si ses usages apparaissent. */
  exclut?: RegExp;
  publie: boolean;
}

export const UPWORK_PORTFOLIO: readonly UpworkPortfolioProject[] = [
  {
    id: "rag-chatbot",
    titre: "RAG AI Chatbot: Ask Questions to Your Documents, With Sources",
    lien: "axelremillat.com/en/projets/vega?ref=upwork",
    usages: /chat ?bot|\brag\b|retrieval|knowledge base|faq|conversational|virtual assistant|ai assistant|answers? (customer |user )?questions|ask questions|with sources|cite (the )?sources?/i,
    publie: true,
  },
  {
    id: "invoice-extraction",
    titre: "AI Invoice Extraction: PDF or Photo to Structured Data in Seconds",
    lien: "axelremillat.com/en/automatisations?demo=invoice&ref=upwork",
    usages: /invoices?|receipts?|\bocr\b|scanned|data extraction|extract(ing|ion)? (data|fields|information)|pdf (to|into)|from (pdf|documents?)|document (processing|extraction|parsing)|\berp\b/i,
    publie: true,
  },
  {
    // ORION (Cowork #66) : application privée — cité par son titre, SANS lien de démo. Prospection seulement.
    id: "lead-generation",
    titre: "AI Lead Generation System: Sourcing, Scoring and Human-Approved Emails",
    lien: null,
    usages: /lead gen(eration)?|prospect(ing|ion|s)?\b|lead (enrichment|scoring|sourcing|list)|enrich(ing|ment)? (of )?(b2b )?(leads|prospects|contacts)|scor(e|es|ing) (b2b )?(leads|prospects)|cold (e-?mail|outreach)|outbound|outreach|find (new )?(b2b )?(clients|customers|leads|prospects)/i,
    exclut: /chat ?bot|\brag\b|knowledge base|faq|support (inbox|tickets?|team|emails?)|help ?desk|customer (support|service)|invoices?|billing|receipts?/i,
    publie: true,
  },
  {
    id: "quote-agent",
    titre: "AI Quote Agent: Customer Request to Priced Quote and Reply",
    lien: "axelremillat.com/en/agent?ref=upwork",
    usages: /quotes?\b|quotation|estimates?\b|pricing request|function calling|tool calling|lead qualification|qualify (inbound )?leads|custom ai agent/i,
    publie: false,
  },
  {
    id: "email-triage",
    titre: "AI Email Triage Automation for Small Businesses (n8n + OpenAI)",
    lien: "axelremillat.com/en/automatisations?demo=email&ref=upwork",
    usages: /e-?mails?|inbox|gmail|outlook|support|triage|routing|draft (replies|responses)|slack|crm|hubspot|pipedrive|zapier|make\.com|\bmake\b|n8n|integromat|migrat/i,
    publie: true,
  },
];

/** Projets citables (publiés), dans l'ordre de priorité ci-dessus. */
export const publishedUpworkProjects = () => UPWORK_PORTFOLIO.filter((project) => project.publie);

/** Le projet par défaut : le tri des e-mails, l'automatisation n8n + OpenAI la plus générale. */
const DEFAULT_ID: UpworkPortfolioProject["id"] = "email-triage";

/**
 * Le projet PUBLIÉ le plus proche de l'annonce : le premier dont les usages apparaissent (chatbot avant factures,
 * car un chatbot « sur nos PDF » n'est pas une extraction), sinon le tri des e-mails. Jamais un projet non publié.
 */
export function upworkProject(context: string): UpworkPortfolioProject {
  const published = publishedUpworkProjects();
  return (
    published.find((project) => project.id !== DEFAULT_ID && project.usages.test(context) && !project.exclut?.test(context)) ??
    published.find((project) => project.id === DEFAULT_ID)!
  );
}

/** Titres citables : tout titre cité dans une proposition doit en faire partie. */
export const citableUpworkTitles = () => publishedUpworkProjects().map((project) => project.titre);
