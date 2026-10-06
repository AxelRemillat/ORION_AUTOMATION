import { chatJson } from "@/lib/ai/chat";
import { fetchHtml } from "@/lib/contact-finder/clients";
import { getOpenAI } from "@/lib/openai";
import type { Db } from "@/lib/trash/scope";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { extractFacts, FACTS_VERSION, type FactsDeps, type FactsRun, type SourcedFact } from "./facts";

/**
 * Faits distinctifs d'une fiche (lib/enrichment/facts.ts), écrits dans
 * `key_figures` par FUSION avec la fiche relue juste avant : aucun champ
 * existant n'est effacé. Relus du cache s'ils ont moins de 30 jours.
 *
 * Coût : un appel du rôle « profile » (modèle léger, gpt-6-luna par défaut),
 * ~6 000 jetons en entrée et 900 au plus en sortie par fiche, imputé à la fiche
 * (`api_usage`, opération « facts »). Les pages sont lues en direct (gratuit).
 */

const FRESH_MS = 30 * 86_400_000;

export interface FactsProspect {
  id: string;
  company_name: string;
  website: string | null;
  key_figures: Record<string, unknown> | null;
}

export function liveFactsDeps(prospectId: string): FactsDeps {
  return {
    fetchHtml,
    ask: (system, user) =>
      chatJson({
        client: getOpenAI(),
        role: "profile",
        system,
        user,
        temperature: 0,
        maxOutputTokens: 900,
        operation: "facts",
        onUsage: (usage) =>
          recordOpenAiUsage({ model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, operation: usage.operation, prospectId }),
      }),
  };
}

/** Faits déjà extraits et encore frais, ou `null`. */
export function storedFacts(figures: Record<string, unknown> | null | undefined, now = new Date()): SourcedFact[] | null {
  if (!figures || !Array.isArray(figures.facts) || figures.facts_version !== FACTS_VERSION) return null;
  const at = typeof figures.facts_at === "string" ? Date.parse(figures.facts_at) : NaN;
  return Number.isFinite(at) && now.getTime() - at < FRESH_MS ? (figures.facts as SourcedFact[]) : null;
}

export async function ensureFacts(
  db: Db,
  prospect: FactsProspect,
  options: { force?: boolean; now?: Date; deps?: FactsDeps } = {},
): Promise<FactsRun | null> {
  const now = options.now ?? new Date();
  const known = storedFacts(prospect.key_figures, now);
  if (known && !options.force) return { facts: known, score: (prospect.key_figures?.facts_score as 0 | 1 | 2 | 3) ?? 0, pages: [], note: "cache" };
  if (!prospect.website) return null;

  const run = await extractFacts(prospect.company_name, prospect.website, options.deps ?? liveFactsDeps(prospect.id));
  // Fiche RELUE juste avant l'écriture : on fusionne, on n'écrase rien.
  const { data } = await db.from("prospects").select("key_figures").eq("id", prospect.id).maybeSingle();
  const fresh = ((data as { key_figures?: Record<string, unknown> | null } | null)?.key_figures ?? prospect.key_figures ?? {}) as Record<string, unknown>;
  const figures = {
    ...fresh,
    facts: run.facts,
    facts_score: run.score,
    facts_at: now.toISOString(),
    facts_version: FACTS_VERSION,
    ...(run.note ? { facts_note: run.note } : {}),
  };
  await db.from("prospects").update({ key_figures: figures } as never).eq("id", prospect.id);
  prospect.key_figures = figures;
  return run;
}
