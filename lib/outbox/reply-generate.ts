import { AUTO_REPLY_LABEL, autoReplyKind } from "@/lib/inbound/auto-reply";
import { getOpenAI } from "@/lib/openai";
import { modelFor, reasoningEffortFor } from "@/lib/ai/models";
import { buildParams } from "@/lib/ai/params";
import { withParamFallback } from "@/lib/ai/chat";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { buildReplyContext, buildReplySystemPrompt, buildThread, parseReplyDraft } from "@/app/api/emails/reply/prompt";
import type { Db } from "@/lib/trash/scope";
import type { InboundMessage, Message, Prospect } from "@/types";
import { currentReplyDraft, saveReplyDraft, type ReplyDraftResult } from "./reply-draft";

/**
 * Brouillon de réponse préparé SANS écran : la préparation de « Aujourd'hui »
 * l'écrit pour chaque mail reçu non traité, afin qu'Axel n'ait plus qu'à
 * relire. Même prompt que POST /api/emails/reply, même enregistrement
 * (`saveReplyDraft`, dans le fil Gmail). Rien n'est envoyé.
 *
 * Un brouillon déjà présent n'est jamais réécrit : il a pu être retouché.
 */

const MODEL_BUDGET_MS = 45_000;

export type ReplyCompletion = (system: string, user: string) => Promise<string>;

async function liveCompletion(system: string, user: string, prospectId: string | null): Promise<string> {
  const model = modelFor("writer");
  const completion = await withParamFallback(
    model,
    () => buildParams({ model, temperature: 0.6, reasoningEffort: reasoningEffortFor("writer") }),
    (params) =>
      getOpenAI().chat.completions.create(
        {
          ...(params as { model: string }),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        { timeout: MODEL_BUDGET_MS, maxRetries: 0 },
      ),
  );
  if (completion.usage) {
    await recordOpenAiUsage({
      model,
      promptTokens: completion.usage.prompt_tokens,
      completionTokens: completion.usage.completion_tokens,
      operation: "reply",
      prospectId,
    });
  }
  return completion.choices[0]?.message?.content ?? "";
}

export async function draftReply(
  db: Db,
  input: { userId: string; inbound: InboundMessage; complete?: ReplyCompletion },
): Promise<ReplyDraftResult | { ok: true; messageId: string; existing: true }> {
  const { inbound } = input;
  if (!inbound.prospect_id) return { ok: false, error: "Expéditeur non rattaché à un prospect." };
  const auto = autoReplyKind(inbound);
  if (auto) return { ok: false, error: `${AUTO_REPLY_LABEL[auto]} : ce n'est pas le prospect qui écrit, pas de réponse IA.` };
  const existing = await currentReplyDraft(db, inbound.id);
  if (existing) return { ok: true, messageId: existing.id, existing: true };

  const [prospectRes, messagesRes, inboundRes] = await Promise.all([
    db.from("prospects").select("*").eq("id", inbound.prospect_id).is("deleted_at", null).maybeSingle(),
    db.from("messages").select("*").eq("prospect_id", inbound.prospect_id).is("deleted_at", null).order("created_at", { ascending: true }),
    db.from("inbound_messages").select("*").eq("prospect_id", inbound.prospect_id).is("deleted_at", null).order("received_at", { ascending: true }),
  ]);
  const prospect = (prospectRes.data as Prospect | null) ?? null;
  if (!prospect) return { ok: false, error: "Prospect à la corbeille." };
  const thread = buildThread((messagesRes.data ?? []) as Message[], ((inboundRes.data ?? []) as InboundMessage[]) ?? [inbound]);

  const system = buildReplySystemPrompt(inbound.category);
  const user = buildReplyContext(prospect, thread, inbound);
  const raw = input.complete ? await input.complete(system, user) : await liveCompletion(system, user, inbound.prospect_id);
  const draft = parseReplyDraft(raw, inbound.subject);
  if (!draft) return { ok: false, error: "Réponse du modèle inexploitable." };
  return saveReplyDraft(db, { userId: input.userId, inboundId: inbound.id, subject: draft.subject, body: draft.body });
}
