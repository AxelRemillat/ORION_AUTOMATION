import OpenAI from "openai";
import { requireEnv } from "@/lib/env";

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
}): Promise<string> {
  const response = await getOpenAI().chat.completions.create({
    model: params.model ?? OPENAI_MODEL,
    temperature: params.temperature ?? 0.7,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}
