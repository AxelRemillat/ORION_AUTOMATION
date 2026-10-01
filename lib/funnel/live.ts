import type { SupabaseClient } from "@supabase/supabase-js";
import { hunterStatus } from "@/lib/hunter/gate";
import { supabaseHunterStore } from "@/lib/hunter/store";
import { chatJson, type AskFn } from "@/lib/ai/chat";
import { findContact } from "@/lib/contact-finder";
import { buildFacts } from "@/lib/emails/derived-facts";
import { hookReadiness } from "@/lib/emails/hook-readiness";
import { runStrategist } from "@/lib/emails/strategist";
import { deepEnrich, toProspectInsert } from "@/lib/enrichment";
import { getOpenAI } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage/record";
import type { Database, Prospect } from "@/types";
import { toProspectSignal, type DigDeps } from "./dig";
import { triageModel, type TriageAsk } from "./triage";

/**
 * Branchements RÉELS des étages 3 et 4 (OpenAI, Pappers, contact). Les tests
 * passent par des doubles ; ce module ne tourne qu'en production ou en local
 * avec les clés.
 */

type Db = SupabaseClient<Database>;

const ask = (prospectId: string | null): AskFn => (role, system, user, temperature, operation) =>
  chatJson({
    client: getOpenAI(),
    role,
    system,
    user,
    temperature,
    operation,
    onUsage: (usage) =>
      recordOpenAiUsage({
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        operation: usage.operation,
        prospectId,
      }),
  });

/** Tri LLM : modèle bon marché dédié, rôle d'extraction (JSON strict). */
export const liveTriageAsk: TriageAsk = (system, user) =>
  chatJson({
    client: getOpenAI(),
    role: "extract",
    model: triageModel(),
    system,
    user,
    temperature: 0,
    operation: "entonnoir:tri",
    onUsage: (usage) =>
      recordOpenAiUsage({
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        operation: usage.operation,
      }),
  });

/** Brief du stratège sur une fiche fraîchement créée (pas d'historique d'envoi). */
async function briefFor(db: Db, prospectId: string): Promise<void> {
  const { data } = await db.from("prospects").select("*").eq("id", prospectId).maybeSingle();
  if (!data) return;
  const prospect = data as Prospect;
  const facts = buildFacts(prospect);
  // Même gating que la génération de mail : pas de brief sans accroche datée.
  if (!hookReadiness(facts.facts).ready) return;

  const figures = prospect.key_figures ?? {};
  const outcome = await runStrategist(
    (system, user, operation) => ask(prospectId)("strategist", system, user, 0.2, operation),
    {
      facts: facts.facts,
      companyName: facts.companyName,
      isLargeGroupSubsidiary: facts.isLargeGroupSubsidiary,
      parentGroup: (typeof figures.parent_group === "string" ? figures.parent_group : null) ?? facts.parent,
      foreignEntities: facts.foreignEntities,
      history: [],
      sector: prospect.sector,
    },
  );
  if (outcome.brief) await db.from("prospects").update({ brief: outcome.brief }).eq("id", prospectId);
}

export function liveDigDeps(db: Db, userId: string, runId: string): DigDeps {
  return {
    enrich: async (candidate) => {
      const company = await deepEnrich(candidate.base, [], [], {
        attachedSignals: [toProspectSignal(candidate.signal)],
      });
      const leader = candidate.signal.facts.newLeaders?.[0];
      return {
        ...company,
        key_figures: {
          ...company.key_figures,
          signal_source: candidate.signal.source === "bodacc" ? "bodacc" : "france-travail",
          signal_date: candidate.signal.date,
          signal_label: candidate.signal.facts.label,
          ...(leader ? { new_leader_name: `${leader.firstName} ${leader.surname}`, new_leader_role: leader.role } : {}),
          ...(candidate.signal.facts.jobTitle ? { job_title: candidate.signal.facts.jobTitle } : {}),
          funnel_run_id: runId,
          funnel_score: candidate.triage.score,
          funnel_hook: candidate.triage.accroche_possible,
        },
      };
    },
    createProspect: async (company, candidate) => {
      const { data, error } = await db
        .from("prospects")
        .insert({ ...toProspectInsert(company, "auto"), user_id: userId, pain_point: candidate.triage.pain_probable || null })
        .select("id")
        .single();
      if (error?.code === "23505") return { existing: true };
      if (error || !data) return { error: error?.message ?? "insertion refusée" };
      return { id: data.id };
    },
    findContact: async (prospectId) => {
      const contact = await findContact(prospectId);
      if (contact.email) {
        await db.from("prospects").update({ email: contact.email }).eq("id", prospectId).is("email", null);
      }
      return contact;
    },
    brief: (prospectId) => briefFor(db, prospectId),
    hunterBlocked: async () => (await hunterStatus(supabaseHunterStore())).blocked,
  };
}
