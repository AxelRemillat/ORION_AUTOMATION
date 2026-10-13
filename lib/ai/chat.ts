import type OpenAI from "openai";
import { modelFor, reasoningEffortFor, type AiRole } from "./models";
import {
  buildParams,
  capabilityToDrop,
  isUnsupportedParamError,
  readOpenAiError,
  rememberUnsupported,
  unsupportedParamMessage,
  type ChatParams,
} from "./params";
import { guardOpenAi } from "./quota";

/**
 * Un appel JSON à OpenAI pour un rôle donné.
 *
 * Pur et injectable : le client et la journalisation sont passés par
 * l'appelant. La route journalise dans `api_usage` ; le script d'évaluation
 * cumule coût et latence en mémoire. Les deux passent par le même code, donc
 * par les mêmes paramètres de modèle.
 *
 * Tous les paramètres viennent de `buildParams` : aucun `temperature` ni
 * `max_tokens` en dur ici ni ailleurs.
 */

export interface ChatUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Tokens d'entrée servis par le cache de prompt d'OpenAI (Cowork #54) — facturés au prix « cached_input ». */
  cachedTokens?: number;
  /** Tokens de raisonnement (inclus dans completionTokens). */
  reasoningTokens?: number;
  latencyMs: number;
  operation: string;
}

/** Erreur d'appel destinée à être AFFICHÉE : elle dit quoi et pourquoi. */
export class AiCallError extends Error {
  constructor(
    message: string,
    readonly model: string,
    readonly param?: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AiCallError";
  }
}

export interface ChatJsonRequest {
  client: OpenAI;
  role: AiRole;
  system: string;
  user: string;
  /** Température VOULUE. Ignorée par un modèle qui ne la supporte pas. */
  temperature: number;
  operation: string;
  /** Force un modèle précis — A/B du script d'évaluation. */
  model?: string;
  /** Plafond de sortie, posé sous le nom attendu par le modèle. */
  maxOutputTokens?: number;
  onUsage?: (usage: ChatUsage) => void | Promise<void>;
  /** Journalisation des avertissements ; `console.warn` par défaut. */
  onWarn?: (message: string) => void;
}

/**
 * Rejoue un appel une fois quand le modele refuse un parametre.
 *
 * Partage par tous les appels OpenAI du projet : `chatJson`, l'extraction et
 * la generation de reponses. Le `build` est rappele APRES la mise a jour des
 * capacites, pour que le second essai parte avec le bon corps.
 *
 * C'est aussi LE point de garde du credit (lib/ai/quota.ts) : quota ou
 * facturation → `OpenAIQuotaError` (jamais reessayee) ; limite de debit →
 * nouvel essai apres attente.
 */
export async function withParamFallback<T>(
  model: string,
  build: () => ChatParams,
  send: (params: ChatParams) => Promise<T>,
  onWarn: (message: string) => void = (message) => console.warn(message),
): Promise<T> {
  try {
    return await guardOpenAi(() => send(build()));
  } catch (error) {
    const info = readOpenAiError(error);
    if (!isUnsupportedParamError(info)) throw error;

    const patch = capabilityToDrop(info.param);
    if (!patch) throw new AiCallError(unsupportedParamMessage(model, info), model, info.param, error);

    rememberUnsupported(model, patch);
    onWarn(
      `[ai] ${model} refuse « ${info.param} » (${info.code ?? "sans code"}) : ` +
        "capacité retirée, appel rejoué sans elle.",
    );
    try {
      return await guardOpenAi(() => send(build()));
    } catch (retryError) {
      const retryInfo = readOpenAiError(retryError);
      throw new AiCallError(unsupportedParamMessage(model, retryInfo), model, retryInfo.param, retryError);
    }
  }
}

/**
 * Graine fixe des JUGES (Cowork #31) : gpt-6 refuse `temperature: 0`, la
 * graine et un prompt figé sont ce qui reste pour qu'un même mail reçoive la
 * même note d'un passage à l'autre.
 */
export const JUDGE_SEED = 31;

export async function chatJson(request: ChatJsonRequest): Promise<string> {
  const model = request.model ?? modelFor(request.role);
  const started = Date.now();

  const completion = await withParamFallback(
    model,
    () =>
      buildParams({
        model,
        temperature: request.temperature,
        reasoningEffort: reasoningEffortFor(request.role),
        maxOutputTokens: request.maxOutputTokens,
        seed: request.role === "judge" ? JUDGE_SEED : undefined,
      }),
    (params) =>
      request.client.chat.completions.create({
        ...(params as { model: string }),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      }),
    request.onWarn,
  );

  if (request.onUsage) {
    await request.onUsage({
      model,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      cachedTokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      reasoningTokens: completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
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
