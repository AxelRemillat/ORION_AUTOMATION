import OpenAI from "openai";
import { requireEnv } from "@/lib/env";
import { recordOpenAiUsage } from "@/lib/usage/record";

/** Modèle par défaut, surchargeable via OPENAI_MODEL. */
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

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
  /** Operation journalisee dans api_usage. */
  operation?: string;
  prospectId?: string | null;
}): Promise<string> {
  const model = params.model ?? OPENAI_MODEL;
  const response = await getOpenAI().chat.completions.create({
    model,
    temperature: params.temperature ?? 0.7,
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
