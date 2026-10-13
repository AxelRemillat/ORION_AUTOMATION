import { chatJson, type AskFn } from "@/lib/ai/chat";
import { getOpenAI } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { analyzeOpportunity } from "./analyze";
import { generateProposal } from "./proposal";
import { proposalLanguage, type Opportunity } from "./types";
import { freshScore, statusAfterAnalysis } from "./ingest";
import { generateLaunchProposal, laneOf } from "./launch";
import { PROPOSAL_FAILED } from "./proposal-state";

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
        recordOpenAiUsage({ model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, cachedTokens: usage.cachedTokens, operation: usage.operation }),
    });
}

export type RunResult = { ok: true; score: number | null; proposalScore: number | null } | { ok: false; error: string };

export async function analyzeAndPropose(db: Db, userId: string, id: string, ask: AskFn = opportunityAsk()): Promise<RunResult> {
  const { data, error } = await db.from("opportunities").select("*").eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: "Opportunité introuvable." };
  const opportunity = data as Opportunity;
  const lane = laneOf(opportunity);

  // Mission de lancement réduite à son TITRE (alerte e-mail Codeur, Cowork #21) : pas d'analyse
  // (un score sur un titre ne veut rien dire), la proposition de lancement seule, sur le titre.
  if (lane === "lancement" && opportunity.body.trim() === opportunity.title.trim()) {
    const launch = await generateLaunchProposal({ ask, title: opportunity.title, body: opportunity.body, budget: opportunity.budget });
    if ("error" in launch) return failed(db, id, launch.error);
    await writeProposal(db, id, launch, true);
    return { ok: true, score: null, proposalScore: launch.score };
  }

  const analysis = await analyzeOpportunity(ask, opportunity);
  if (!analysis) {
    // Analyse impossible : « Non analysée », jamais « Ignorée » (plateformes #10).
    await db.from("opportunities").update({ analysis_state: "non_analysee", updated_at: new Date().toISOString() }).eq("id", id);
    return failed(db, id, "Analyse indisponible : réessayez dans un instant.");
  }
  // Annonce ancienne : jamais d'alerte (6 au plus). Une fiche « Ignorée » re-notée à 5 ou plus revient « À répondre ».
  analysis.score = freshScore(analysis.score, opportunity.published_at);
  // Mission de lancement / CMS imposé (11/10/2026) : jamais « Ignorée » par l'analyse ; une fiche ignorée revient « À répondre ».
  const status = lane ? (opportunity.status === "ignoree" ? "a_repondre" : null) : statusAfterAnalysis(opportunity.status, analysis.score);
  await db
    .from("opportunities")
    .update({
      fit_score: analysis.score,
      fit_reasons: analysis.reasons,
      need: analysis.need,
      demo: analysis.demo,
      language: analysis.language,
      analyzed_at: new Date().toISOString(),
      analysis_state: "ok",
      filter_reason: null,
      ...(status ? { status } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  // Mission de lancement : prix fixe de lancement contre un avis honnête (lib/opportunities/launch.ts).
  const proposal =
    lane === "lancement"
      ? await generateLaunchProposal({ ask, title: opportunity.title, body: opportunity.body, budget: opportunity.budget, need: analysis.need })
      : await generateProposal({
          ask,
          platform: opportunity.platform,
          language: proposalLanguage(opportunity.platform, analysis.language),
          title: opportunity.title,
          body: opportunity.body,
          budget: opportunity.budget,
          need: analysis.need,
          demo: analysis.demo,
          kind: analysis.kind,
        });
  if ("error" in proposal) return failed(db, id, proposal.error);
  await writeProposal(db, id, proposal, opportunity.description_truncated === true);
  return { ok: true, score: analysis.score, proposalScore: proposal.score };
}

/** Échec écrit sur la fiche (sans proposition) : le bouton ne tourne plus indéfiniment. */
async function failed(db: Db, id: string, error: string): Promise<RunResult> {
  await db
    .from("opportunities")
    .update({ proposal_reason: `${PROPOSAL_FAILED} : ${error}`, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("proposal", null);
  return { ok: false, error };
}

async function writeProposal(db: Db, id: string, proposal: Exclude<Awaited<ReturnType<typeof generateProposal>>, { error: string }>, onExcerpt: boolean): Promise<void> {
  await db
    .from("opportunities")
    .update({
      proposal: proposal.text,
      proposal_score: proposal.score,
      proposal_reason: proposal.needsReview ? proposal.reason : null,
      proposal_on_excerpt: onExcerpt,
      suggested_amount_eur: proposal.amountEur,
      suggested_delay_days: proposal.delayDays,
      suggested_currency: proposal.currency,
      suggested_hourly: proposal.hourly,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}
