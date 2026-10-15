import type { AskFn } from "@/lib/ai/chat";
import { DEMO_HOST, DEMO_LINKS, type DemoLink } from "@/lib/emails/quality/demo-links";
import type { Language, Platform } from "./types";
import type { ProjectKind } from "./requests";

/**
 * ANALYSE D'ADÉQUATION d'une annonce (modèle léger, un appel).
 *
 * Score 0–10 avec trois raisons, besoin reformulé, démo la plus pertinente et
 * langue de l'annonce. Le score dit si la mission correspond à ce qu'Axel fait
 * vraiment — pas si l'annonce est « bonne ».
 */

export const WE_DO = [
  "tri et réponse aux e-mails",
  "devis (préparation, chiffrage assisté)",
  "factures et relances de paiement",
  "comptes rendus (réunions, appels)",
  "nettoyage de fichiers CSV / fichier clients",
  "SAV et réponses au service client",
  "chatbots et assistants sur documents (RAG)",
  "intégrations API et automatisations n8n",
  // Full-stack (décision d'Axel, 06/10/2026), sur sa stack :
  "applications web, SaaS, MVP, CRM ou outils internes sur mesure",
  "front-end React / Next.js, back-end Node.js / API REST",
  "bases de données Supabase, PostgreSQL, Firebase ; dashboards",
  // Développement web (décision d'Axel, 11/10/2026 — premières missions et premiers avis) :
  "sites vitrines, landing pages, sites d'affiliation, blogs, refontes de site, avec leur base SEO technique",
] as const;

export const WE_AVOID = [
  "applications mobiles natives seules (iOS / Android, Swift, Kotlin)",
  "e-commerce lourd (Magento, catalogue de plus de 100 produits)",
  "PHP / Laravel / Symfony / Windev / .NET / Java",
  "SEO, rédaction, publicité (Ads) ou community management SANS création de site",
  "jeux vidéo, graphisme, design, vidéo, 3D",
  "data science lourde (modèles, recherche)",
] as const;

/** React Native / Flutter : pas exclus, mais jamais en alerte (à voir, 6 au plus). */
const CROSS_PLATFORM_MOBILE = /(react native|flutter|\bexpo\b)/i;
export const CROSS_PLATFORM_MAX_SCORE = 6;

/** Démos proposables, par clé (lien vers axelremillat.com). */
export const DEMO_KEYS = ["devis", "emails", "factures", "reporting", "fichier", "sav", "general"] as const satisfies readonly DemoLink["key"][];

export interface Analysis {
  score: number;
  reasons: string[];
  need: string;
  demo: DemoLink["key"];
  language: Language;
  /** Automatisation / IA, ou application web full-stack. */
  kind: ProjectKind;
}

/**
 * Lien de démo suivi par plateforme : `&ref=upwork` (ou `?ref=` si le chemin n'a pas de paramètre). Le portfolio
 * attribue la visite par `?ref=` (lib/analytics.ts de PORTFOLIO_V2) ; `src=` n'y était pas lu (Cowork #63).
 * Upwork est en anglais : la version `/en` des pages de démo.
 */
export function opportunityDemoUrl(demo: DemoLink["key"], platform: Platform): string {
  const path = `${platform === "upwork" ? "/en" : ""}${DEMO_LINKS[demo].path}`;
  return `${DEMO_HOST}${path}${path.includes("?") ? "&" : "?"}ref=${platform}`;
}

export function buildAnalysisPrompt(): string {
  const demos = DEMO_KEYS.map((key) => `- ${key} : ${DEMO_LINKS[key].label}`).join("\n");
  return `Tu analyses une annonce de mission freelance pour Axel Remillat, indépendant en IA et automatisation de tâches pour les PME, qui prend aussi des missions de développement web full-stack sur sa stack (React / Next.js, Node.js, Supabase / PostgreSQL).

CE QU'IL FAIT (adéquation forte) :
${WE_DO.map((line) => `- ${line}`).join("\n")}

CE QU'IL ÉVITE (adéquation faible, 0 à 3) :
${WE_AVOID.map((line) => `- ${line}`).join("\n")}

SCORE D'ADÉQUATION 0 à 10 : 8-10 = cœur de métier, livrable clair ; 5-7 = en partie (une brique automatisable dans un projet plus large) ; 0-4 = hors périmètre ou trop flou pour chiffrer. Une mission DANS le périmètre (CRM, intégration, automatisation) qui exige une certification ou des références propres à un éditeur (Zoho, Salesforce, HubSpot…) vaut 5 ou 6 : à voir, c'est à Axel de décider — pas moins.
Trois raisons courtes, factuelles, tirées de l'annonce (jamais inventées).
Besoin reformulé : une ou deux phrases, en français, ce que le client veut obtenir concrètement.
Type : "automatisation" (IA, automatisation, intégration entre outils existants) ou "fullstack" (application web, SaaS, MVP, CRM ou outil interne à développer).
React Native / Flutter : 6 au plus (à voir).
DÉVELOPPEMENT WEB (site vitrine, landing page, site d'affiliation, blog, refonte, application web, MVP) : DANS le périmètre — ne l'écarte pas. Le « SEO de base » d'un projet de site (titres, balisage, plan du site, Search Console) en fait partie. Un petit budget (« Moins de 500 € ») NE BAISSE PAS le score de ces missions : ce sont des missions de lancement. Un CMS imposé (WordPress, Wix, Shopify, Webflow…) : 5 à 7, c'est à Axel de juger.
Démo la plus pertinente, une clé parmi :
${demos}
Langue de l'annonce : "fr" ou "en".

Réponds UNIQUEMENT en JSON : {"score":0-10,"reasons":["…","…","…"],"need":"…","demo":"<clé>","language":"fr|en","kind":"automatisation|fullstack"}`;
}

export function parseAnalysis(raw: string): Analysis | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const score = Number(value.score);
  const reasons = Array.isArray(value.reasons) ? value.reasons.filter((line): line is string => typeof line === "string" && line.trim().length > 0).map((line) => line.trim()) : [];
  const need = typeof value.need === "string" ? value.need.trim() : "";
  if (!Number.isFinite(score) || !need || reasons.length === 0) return null;
  const demo = (DEMO_KEYS as readonly string[]).includes(String(value.demo)) ? (value.demo as DemoLink["key"]) : "general";
  const language: Language = value.language === "en" ? "en" : "fr";
  const kind: ProjectKind = value.kind === "fullstack" ? "fullstack" : "automatisation";
  return { score: Math.max(0, Math.min(10, Math.round(score * 10) / 10)), reasons: reasons.slice(0, 3), need, demo, language, kind };
}

export async function analyzeOpportunity(ask: AskFn, input: { title: string; body: string; budget: string | null; platform: Platform }): Promise<Analysis | null> {
  const raw = await ask(
    "judge",
    buildAnalysisPrompt(),
    `Plateforme : ${input.platform}\nTitre : ${input.title}\nBudget : ${input.budget || "non indiqué"}\n\nANNONCE :\n${input.body.slice(0, 6000)}`,
    0,
    "opportunites:analyse",
  ).catch(() => "");
  const analysis = parseAnalysis(raw);
  // React Native / Flutter : plafond déterministe, le modèle ne décide pas seul.
  if (analysis && CROSS_PLATFORM_MOBILE.test(`${input.title} ${input.body}`)) analysis.score = Math.min(analysis.score, CROSS_PLATFORM_MAX_SCORE);
  return analysis;
}
