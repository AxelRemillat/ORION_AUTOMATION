/**
 * Paramètres d'appel acceptés par chaque modèle OpenAI.
 *
 * L'incident : après le passage à `gpt-6-sol` / `gpt-6-luna`, toute extraction
 * et toute génération tombaient en 400 —
 *
 *   Unsupported value: 'temperature' does not support 0 with this model.
 *   Only the default (1) value is supported.
 *
 * La détection se faisait par expression régulière sur le NOM du modèle
 * (`/^(o\d|gpt-5)/`). `gpt-6-*` n'y répondait pas, donc `temperature: 0`
 * partait quand même. Une regex de nom ne peut pas suivre : chaque nouvelle
 * famille la casse, et l'erreur ne se voit qu'en production.
 *
 * On raisonne donc en CAPACITÉS, avec trois niveaux qui se complètent :
 *
 *   1. une table par préfixe, renseignée à partir d'appels RÉELS
 *      (`npx tsx scripts/debug-openai-params.ts <modèle>`) ;
 *   2. un défaut prudent pour un modèle inconnu — on n'envoie que ce qui est
 *      universellement accepté ;
 *   3. un apprentissage à chaud : un 400 `unsupported_*` retire la capacité
 *      pour le reste du processus, et l'appel est rejoué sans le paramètre.
 *
 * Résultat : un modèle jamais vu fonctionne du premier coup, et le second
 * appel est déjà correct.
 */

export interface ModelCapabilities {
  /** `temperature` et `top_p` sont acceptés (sinon l'API rend un 400). */
  supportsTemperature: boolean;
  /** `reasoning_effort` est accepté. */
  supportsReasoningEffort: boolean;
  /** `response_format: { type: "json_schema" }` est accepté. */
  supportsJsonSchema: boolean;
  /** Nom du paramètre de budget de sortie. */
  maxOutputParam: "max_tokens" | "max_completion_tokens";
  /** `seed` refusé (appris à chaud d'un 400) ; absent = accepté. */
  rejectsSeed?: boolean;
}

/**
 * Capacités mesurées, par préfixe de nom.
 *
 * Chaque ligne vient d'un appel réel, pas d'une supposition. Les familles de
 * raisonnement partagent le même profil : pas d'échantillonnage réglable,
 * budget de sortie sous un autre nom, effort de raisonnement disponible.
 */
const BY_PREFIX: { prefix: RegExp; capabilities: ModelCapabilities }[] = [
  {
    // Les variantes « -chat » d'une famille de raisonnement se comportent
    // comme un modèle classique : elles acceptent la température.
    prefix: /-chat/i,
    capabilities: {
      supportsTemperature: true,
      supportsReasoningEffort: false,
      supportsJsonSchema: true,
      maxOutputParam: "max_tokens",
    },
  },
  {
    // Mesuré le 25/09/2026 sur gpt-6-sol et gpt-6-luna : `temperature: 0`
    // refusé (unsupported_value), `max_tokens` refusé (unsupported_parameter),
    // `reasoning_effort` et `json_schema` acceptés.
    prefix: /^(gpt-6|gpt-5|o\d)/i,
    capabilities: {
      supportsTemperature: false,
      supportsReasoningEffort: true,
      supportsJsonSchema: true,
      maxOutputParam: "max_completion_tokens",
    },
  },
  {
    prefix: /^gpt-4/i,
    capabilities: {
      supportsTemperature: true,
      supportsReasoningEffort: false,
      supportsJsonSchema: true,
      maxOutputParam: "max_tokens",
    },
  },
];

/**
 * Défaut pour un modèle inconnu : on n'envoie que ce qui ne peut pas être
 * refusé. Mieux vaut une sortie moins pilotée qu'une 400 en production.
 */
export const CONSERVATIVE: ModelCapabilities = {
  supportsTemperature: false,
  supportsReasoningEffort: false,
  supportsJsonSchema: false,
  maxOutputParam: "max_completion_tokens",
};

/**
 * Capacités retirées à chaud, apprises d'un 400.
 *
 * Mémoire du processus : elle survit aux appels suivants d'une même instance
 * serverless, et se reconstruit toute seule ailleurs. Volontairement pas
 * persistée — une capacité peut être rétablie par le fournisseur.
 */
const learned = new Map<string, Partial<ModelCapabilities>>();

/** Remet la mémoire à zéro (tests). */
export function resetLearnedCapabilities(): void {
  learned.clear();
}

export function capabilitiesOf(model: string): ModelCapabilities {
  const name = model.trim();
  const base = BY_PREFIX.find((entry) => entry.prefix.test(name))?.capabilities ?? CONSERVATIVE;
  return { ...base, ...(learned.get(name) ?? {}) };
}

export type ReasoningEffort = "low" | "medium" | "high";

export interface BuildParamsInput {
  model: string;
  /** Température VOULUE. Ignorée si le modèle ne la supporte pas. */
  temperature?: number;
  /** Effort de raisonnement voulu. Ignoré si non supporté. */
  reasoningEffort?: ReasoningEffort;
  /** Budget de sortie, posé sous le nom que le modèle attend. */
  maxOutputTokens?: number;
  /**
   * Graine d'échantillonnage. Les modèles de raisonnement refusent
   * `temperature` : la graine fixe est ce qui reste pour stabiliser un juge.
   */
  seed?: number;
}

export type ChatParams = Record<string, unknown> & { model: string };

/**
 * Corps d'appel adapté au modèle.
 *
 * Point unique : plus aucun `temperature` ni `max_tokens` en dur ailleurs dans
 * le code. Ce qui n'est pas supporté n'est pas envoyé — on ne compte pas sur
 * l'API pour l'ignorer poliment, elle ne le fait pas.
 */
export function buildParams(input: BuildParamsInput): ChatParams {
  const capabilities = capabilitiesOf(input.model);
  const params: ChatParams = { model: input.model };

  if (capabilities.supportsTemperature && input.temperature !== undefined) {
    params.temperature = input.temperature;
  }
  if (capabilities.supportsReasoningEffort && input.reasoningEffort) {
    params.reasoning_effort = input.reasoningEffort;
  }
  if (input.maxOutputTokens !== undefined) {
    params[capabilities.maxOutputParam] = input.maxOutputTokens;
  }
  if (input.seed !== undefined && !capabilities.rejectsSeed) {
    params.seed = input.seed;
  }
  return params;
}

/** Erreur OpenAI, réduite à ce qui permet de décider. */
export interface OpenAiErrorInfo {
  status?: number;
  code?: string;
  param?: string;
  message: string;
}

export function readOpenAiError(error: unknown): OpenAiErrorInfo {
  const raw = error as {
    status?: number;
    code?: string;
    param?: string;
    error?: { code?: string; param?: string; message?: string };
    message?: string;
  };
  return {
    status: raw.status,
    code: raw.error?.code ?? raw.code,
    param: raw.error?.param ?? raw.param,
    message: raw.error?.message ?? raw.message ?? String(error),
  };
}

/**
 * L'appel a-t-il dépassé son délai ?
 *
 * Mesuré contre le SDK (v4.104) : un dépassement lève un `Error` **nu**, de nom
 * « Error » et de message « Request timed out. » — pas la classe
 * `APIConnectionTimeoutError` qu'on attendrait. C'est donc le MESSAGE qui porte
 * l'information, et le nom n'est gardé qu'en filet au cas où une version
 * ultérieure le renseignerait.
 *
 * L'enjeu : un dépassement se dit autrement qu'une panne. L'utilisateur peut
 * réessayer immédiatement, et c'est la seule chose utile à lui écrire.
 */
export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "APIConnectionTimeoutError" || error.name === "AbortError") return true;
  return /timed? ?out|aborted/i.test(error.message);
}

/** Codes qui désignent un paramètre refusé — et non une panne. */
const UNSUPPORTED = new Set(["unsupported_value", "unsupported_parameter"]);

export function isUnsupportedParamError(info: OpenAiErrorInfo): boolean {
  if (info.code && UNSUPPORTED.has(info.code)) return true;
  // Certains refus arrivent sans code, avec un message explicite.
  return /unsupported (?:value|parameter)/i.test(info.message);
}

/**
 * Capacité à retirer, déduite du paramètre refusé.
 *
 * `max_tokens` refusé ne veut pas dire « pas de budget » mais « pas sous ce
 * nom » : on bascule sur l'autre nom plutôt que d'abandonner le plafond.
 */
export function capabilityToDrop(param: string | undefined): Partial<ModelCapabilities> | null {
  switch (param) {
    case "temperature":
    case "top_p":
      return { supportsTemperature: false };
    case "reasoning_effort":
      return { supportsReasoningEffort: false };
    case "max_tokens":
      return { maxOutputParam: "max_completion_tokens" };
    case "max_completion_tokens":
      return { maxOutputParam: "max_tokens" };
    case "response_format":
      return { supportsJsonSchema: false };
    case "seed":
      return { rejectsSeed: true };
    default:
      return null;
  }
}

/** Retient qu'un modèle refuse une capacité, pour tous les appels suivants. */
export function rememberUnsupported(model: string, patch: Partial<ModelCapabilities>): void {
  learned.set(model.trim(), { ...(learned.get(model.trim()) ?? {}), ...patch });
}

/**
 * Message destiné à l'UTILISATEUR quand un modèle refuse un paramètre.
 * Une 500 muette ne dit rien ; celui-ci nomme le modèle et le paramètre.
 */
export function unsupportedParamMessage(model: string, info: OpenAiErrorInfo): string {
  const param = info.param ? `le paramètre « ${info.param} »` : "un paramètre d'appel";
  return `Le modèle ${model} refuse ${param}. Réessayez : la capacité vient d'être retirée pour les appels suivants.`;
}
