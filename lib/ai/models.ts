/**
 * Modèles OpenAI, un par rôle de la chaîne d'emails.
 *
 *   extraction → STRATÈGE → RÉDACTEUR → JUGE
 *
 * Chaque rôle lit sa variable d'environnement serveur. Sans elle, il retombe
 * sur `OPENAI_MODEL`, puis sur `gpt-4o-mini` : c'est exactement le
 * comportement d'avant ce module. Rien ne change tant que les variables ne
 * sont pas renseignées.
 *
 * Module sans dépendance : importable par les routes comme par les scripts.
 */

export const AI_ROLES = ["extract", "strategist", "writer", "judge"] as const;
export type AiRole = (typeof AI_ROLES)[number];

/** Variable d'environnement de chaque rôle. */
export const MODEL_ENV: Record<AiRole, string> = {
  extract: "OPENAI_MODEL_EXTRACT",
  strategist: "OPENAI_MODEL_STRATEGIST",
  writer: "OPENAI_MODEL_WRITER",
  judge: "OPENAI_MODEL_JUDGE",
};

/** Modèle historique du projet, utilisé partout avant la séparation par rôle. */
export const LEGACY_DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Modèles PROPOSÉS par rôle — non appliqués.
 *
 * TODO(tarifs) : la grille officielle (developers.openai.com/api/docs/pricing)
 * n'était pas accessible depuis l'environnement où ce module a été écrit.
 * Choisir sur cette page :
 *   - strategist : un modèle fort de RAISONNEMENT (effort réglable) ;
 *   - writer     : un modèle intermédiaire, bon en rédaction française ;
 *   - extract, judge : le modèle le moins cher qui tient le JSON strict.
 * Puis renseigner OPENAI_MODEL_<ROLE> et leurs prix dans OPENAI_PRICES_JSON
 * (voir lib/usage/pricing.ts). Aucun nom ni prix n'est inventé ici.
 */
export const PROPOSED_MODELS: Record<AiRole, string | null> = {
  strategist: null,
  writer: null,
  extract: null,
  judge: null,
};

type Env = Record<string, string | undefined>;

/** Modèle effectif d'un rôle. */
export function modelFor(role: AiRole, env: Env = process.env): string {
  return env[MODEL_ENV[role]]?.trim() || env.OPENAI_MODEL?.trim() || LEGACY_DEFAULT_MODEL;
}

/**
 * Modèle de raisonnement : familles o1/o3/o4… et gpt-5 (hors variantes
 * « -chat », qui se comportent comme un modèle classique).
 * Ces modèles refusent `temperature` et acceptent `reasoning_effort`.
 */
export function isReasoningModel(model: string): boolean {
  const name = model.toLowerCase();
  if (name.includes("-chat")) return false;
  return /^(o\d|gpt-5)/.test(name);
}

export type ReasoningEffort = "low" | "medium" | "high";
const EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high"];

/**
 * Effort de raisonnement d'un rôle : OPENAI_REASONING_EFFORT_<ROLE>, sinon
 * « medium » pour le stratège (c'est lui qui réfléchit) et « low » ailleurs.
 */
export function reasoningEffortFor(role: AiRole, env: Env = process.env): ReasoningEffort {
  const raw = env[`OPENAI_REASONING_EFFORT_${role.toUpperCase()}`]?.trim().toLowerCase();
  if (raw && (EFFORTS as readonly string[]).includes(raw)) return raw as ReasoningEffort;
  return role === "strategist" ? "medium" : "low";
}

export type SamplingParams =
  | { model: string; temperature: number }
  | { model: string; reasoning_effort: ReasoningEffort };

/**
 * Paramètres d'échantillonnage adaptés au modèle.
 *
 * Un modèle de raisonnement rejette `temperature` (erreur 400) : on envoie à
 * la place l'effort de raisonnement du rôle. Un modèle classique garde la
 * température demandée par l'appelant.
 */
export function samplingParams(
  role: AiRole,
  temperature: number,
  options: { model?: string; env?: Env } = {},
): SamplingParams {
  const env = options.env ?? process.env;
  const model = options.model ?? modelFor(role, env);
  return isReasoningModel(model)
    ? { model, reasoning_effort: reasoningEffortFor(role, env) }
    : { model, temperature };
}
