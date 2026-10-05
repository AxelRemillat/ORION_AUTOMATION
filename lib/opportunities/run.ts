import { chatJson, type AskFn } from "@/lib/ai/chat";
import { getOpenAI } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { analyzeOpportunity } from "./analyze";
import { generateProposal } from "./proposal";
import { proposalLanguage, type Opportunity } from "./types";

/**
 * Analyse + proposition d'une opportunité, puis écriture sur la ligne.
 * Coût visé : ≤ 0,03 € (un appel d'analyse, une à trois rédactions et notes).
 * Rien n'est envoyé : la proposition est à copier.
 */

type Db = { from: (table: string) => any };

export function opportunityAsk(): AskFn {
  return (role, system, user, temperature, operation) =>
    chatJson({
      client: getOpenAI(),
      role,
      system,
      user,
      temperature,
      operation,
      onUsage: (usage) =>
        recordOpenAiUsage({ model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, operation: usage.operation }),
    });
}

export type RunResult = { ok: true; score: number | null; proposalScore: number | null } | { ok: false; error: string };

export async function analyzeAndPropose(db: Db, userId: string, id: string, ask: AskFn = opportunityAsk()): Promise<RunResult> {
  const { data, error } = await db.from("opportunities").select("*").eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: "Opportunité introuvable." };
  const opportunity = data as Opportunity;

  const analysis = await analyzeOpportunity(ask, opportunity);
  if (!analysis) return { ok: false, error: "Analyse indisponible : réessayez dans un instant." };
  await db
    .from("opportunities")
    .update({
      fit_score: analysis.score,
      fit_reasons: analysis.reasons,
      need: analysis.need,
      demo: analysis.demo,
      language: analysis.language,
      analyzed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  const proposal = await generateProposal({
    ask,
    platform: opportunity.platform,
    language: proposalLanguage(opportunity.platform, analysis.language),
    title: opportunity.title,
    body: opportunity.body,
    budget: opportunity.budget,
    need: analysis.need,
    demo: analysis.demo,
  });
  if ("error" in proposal) return { ok: false, error: proposal.error };
  await db
    .from("opportunities")
    .update({ proposal: proposal.text, proposal_score: proposal.score, proposal_reason: proposal.needsReview ? proposal.reason : null, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { ok: true, score: analysis.score, proposalScore: proposal.score };
}
