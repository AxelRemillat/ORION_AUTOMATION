import OpenAI from "openai";
import { requireEnv } from "@/lib/env";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { LEGACY_DEFAULT_MODEL, samplingParams, type AiRole } from "@/lib/ai/models";

/**
 * Modèle historique, surchargeable via OPENAI_MODEL. Les appels passent
 * désormais par `modelFor(role)` (lib/ai/models.ts), qui retombe sur lui.
 */
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? LEGACY_DEFAULT_MODEL;

let client: OpenAI | null = null;

/**
 * Client OpenAI partagé (serveur uniquement).
 * Instancié à la demande pour ne pas exiger la clé au build.
 */
export function getOpenAI(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return client;
}

/**
 * Raccourci pour une complétion texte simple.
 * Les écrans métier peuvent l'utiliser tel quel ou passer par `getOpenAI()`
 * pour des besoins plus fins (streaming, JSON mode, tools…).
 */
export async function completeText(params: {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  /** Rôle dont on prend le modèle quand `model` est absent. Défaut : rédacteur. */
  role?: AiRole;
  /** Operation journalisee dans api_usage. */
  operation?: string;
  prospectId?: string | null;
}): Promise<string> {
  const sampling = samplingParams(params.role ?? "writer", params.temperature ?? 0.7, {
    model: params.model,
  });
  const model = sampling.model;
  const response = await getOpenAI().chat.completions.create({
    ...sampling,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
  });
  if (response.usage) {
    await recordOpenAiUsage({
      model,
      promptTokens: response.usage.prompt_tokens ?? 0,
      completionTokens: response.usage.completion_tokens ?? 0,
      operation: params.operation ?? "completion",
      prospectId: params.prospectId,
    });
  }

  return response.choices[0]?.message?.content?.trim() ?? "";
}
