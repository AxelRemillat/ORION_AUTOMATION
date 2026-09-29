import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "@/lib/ai/chat";
import { signatureFor } from "@/lib/offer/model";
import { loadOffer } from "@/lib/offer/read";
import { getOpenAI } from "@/lib/openai";
import { knownAddresses } from "@/lib/outbox/send";
import { recordOpenAiUsage } from "@/lib/usage/record";
import type { Database } from "@/types";
import { preflight, type PreflightInput, type PreflightResult } from "./index";
import { checkCoherence, subjectModel, type CoherenceCache, type SubjectAsk } from "./subject-ai";

/**
 * Branchements serveur du contrôle avant envoi : signature du compte,
 * adresses trouvées du prospect, verdict de cohérence (LLM, en cache).
 */

type Db = SupabaseClient<Database>;

export const liveSubjectAsk =
  (operation: string, prospectId: string | null = null): SubjectAsk =>
  (system, user) =>
    chatJson({
      client: getOpenAI(),
      role: "extract",
      model: subjectModel(),
      system,
      user,
      temperature: 0,
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

export const coherenceCache = (db: Db, userId: string): CoherenceCache => ({
  async get(hash) {
    const { data } = await db.from("mail_subject_checks").select("coherent, reason").eq("user_id", userId).eq("hash", hash).maybeSingle();
    return data ? { coherent: data.coherent, reason: data.reason } : null;
  },
  async set(hash, value) {
    await db.from("mail_subject_checks").upsert({ user_id: userId, hash, ...value }, { onConflict: "user_id,hash" });
  },
});

export interface PreflightRequest {
  subject: string;
  body: string;
  to?: string | null;
  prospectId?: string | null;
  kind?: PreflightInput["kind"];
  checkRecipient?: boolean;
  subjectReviewed?: boolean;
  /** Demande le verdict LLM « objet cohérent » (1 appel, puis cache). */
  coherence?: boolean;
}

export async function runPreflight(db: Db, userId: string, request: PreflightRequest): Promise<PreflightResult> {
  const { offer } = await loadOffer(db, userId);
  const signature = signatureFor(offer);
  const { data: prospect } = request.prospectId
    ? await db.from("prospects").select("email, key_figures, website").eq("id", request.prospectId).maybeSingle()
    : { data: null };

  const coherence =
    request.coherence && request.subject.trim() && request.body.trim() && process.env.OPENAI_API_KEY
      ? await checkCoherence(
          liveSubjectAsk("preflight:coherence", request.prospectId ?? null),
          { subject: request.subject, body: request.body, signature },
          coherenceCache(db, userId),
        ).catch(() => null)
      : null;

  return preflight({
    subject: request.subject,
    body: request.body,
    to: request.to ?? null,
    signature,
    knownAddresses: knownAddresses(prospect as never),
    website: (prospect as { website?: string | null } | null)?.website ?? null,
    kind: request.kind,
    checkRecipient: request.checkRecipient ?? Boolean(request.to),
    subjectReviewed: request.subjectReviewed,
    coherence,
  });
}
