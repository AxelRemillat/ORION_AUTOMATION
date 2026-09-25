import OpenAI from "openai";
import { requireEnv } from "@/lib/env";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { LEGACY_DEFAULT_MODEL, modelFor, reasoningEffortFor, type AiRole } from "@/lib/ai/models";
import {
  buildParams,
  capabilityToDrop,
  isUnsupportedParamError,
  readOpenAiError,
  rememberUnsupported,
} from "@/lib/ai/params";

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
  // Un seul point de construction des parametres : `buildParams` n'envoie que
  // ce que le modele accepte. Un `temperature` en dur ici repartirait vers un
  // 400 des qu'on change de famille de modele.
  const role = params.role ?? "writer";
  const model = params.model ?? modelFor(role);
  const body = buildParams({
    model,
    temperature: params.temperature ?? 0.7,
    reasoningEffort: reasoningEffortFor(role),
  });

  const send = () =>
    getOpenAI().chat.completions.create({
      ...(body as { model: string }),
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    });

  let response;
  try {
    response = await send();
  } catch (error) {
    // Meme filet qu'ailleurs : on retire la capacite refusee et on rejoue une fois.
    const info = readOpenAiError(error);
    const patch = isUnsupportedParamError(info) ? capabilityToDrop(info.param) : null;
    if (!patch) throw error;
    rememberUnsupported(model, patch);
    console.warn(`[ai] ${model} refuse « ${info.param} » : capacité retirée, appel rejoué.`);
    const retry = buildParams({
      model,
      temperature: params.temperature ?? 0.7,
      reasoningEffort: reasoningEffortFor(role),
    });
    response = await getOpenAI().chat.completions.create({
      ...(retry as { model: string }),
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    });
  }
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
