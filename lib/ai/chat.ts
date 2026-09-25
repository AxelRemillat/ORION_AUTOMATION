import type OpenAI from "openai";
import { samplingParams, type AiRole } from "./models";

/**
 * Un appel JSON à OpenAI pour un rôle donné.
 *
 * Pur et injectable : le client et la journalisation sont passés par
 * l'appelant. La route journalise dans `api_usage` ; le script d'évaluation
 * cumule coût et latence en mémoire. Les deux passent par le même code, donc
 * par les mêmes paramètres de modèle.
 */

export interface ChatUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  operation: string;
}

export interface ChatJsonRequest {
  client: OpenAI;
  role: AiRole;
  system: string;
  user: string;
  /** Ignorée pour un modèle de raisonnement (effort de raisonnement à la place). */
  temperature: number;
  operation: string;
  /** Force un modèle précis — A/B du script d'évaluation. */
  model?: string;
  onUsage?: (usage: ChatUsage) => void | Promise<void>;
}

export async function chatJson(request: ChatJsonRequest): Promise<string> {
  const params = samplingParams(request.role, request.temperature, { model: request.model });
  const started = Date.now();
  const completion = await request.client.chat.completions.create({
    ...params,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
  });

  if (request.onUsage) {
    await request.onUsage({
      model: params.model,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
      operation: request.operation,
    });
  }
  return completion.choices[0]?.message?.content ?? "";
}

/** Signature commune du stratège, du rédacteur et du juge. */
export type AskFn = (
  role: AiRole,
  system: string,
  user: string,
  temperature: number,
  operation: string,
) => Promise<string>;
