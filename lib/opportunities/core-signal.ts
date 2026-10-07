/**
 * SIGNAL FORT DU CŒUR DE CIBLE, sans LLM (Cowork #35) : quand l'analyse est
 * impossible (crédit OpenAI épuisé), une offre qui parle d'IA, d'agent,
 * d'automatisation, de n8n, d'API, d'intégration, de full stack, de
 * React/Next.js ou de base de données mérite quand même une alerte.
 *
 * Renvoie les mots trouvés (vide = pas de signal fort). Pur.
 */
const CORE: { label: string; pattern: RegExp }[] = [
  { label: "IA", pattern: /\b(ia|i\.a\.|intelligence artificielle|ai|llm|gpt|chatgpt|openai|mistral|claude)\b/i },
  { label: "agent", pattern: /\bagents?\s+(ia|ai|conversationnel|intelligent)|\bchatbot|\bassistant (ia|virtuel)/i },
  { label: "automatisation", pattern: /automatis|automation|workflow|\brpa\b/i },
  { label: "n8n / Make / Zapier", pattern: /\bn8n\b|\bmake\.com\b|\bintegromat\b|\bzapier\b/i },
  { label: "API", pattern: /\bapi\b|\bapis\b|\bwebhook/i },
  { label: "intégration", pattern: /int[ée]gration|connecteur|synchronis/i },
  { label: "full stack", pattern: /full[\s-]?stack/i },
  { label: "React / Next.js", pattern: /\breact\b|next\.?js|\bnode\.?js\b|typescript/i },
  { label: "base de données", pattern: /base de donn[ée]es|\bsql\b|postgres|supabase|\bdatabase\b/i },
  { label: "scraping / données", pattern: /scraping|extraction de donn[ée]es|\betl\b/i },
];

export function coreSignals(input: { title: string; description?: string | null; categories?: readonly string[] }): string[] {
  const text = [input.title, input.description ?? "", ...(input.categories ?? [])].join("\n");
  return CORE.filter((item) => item.pattern.test(text)).map((item) => item.label);
}
