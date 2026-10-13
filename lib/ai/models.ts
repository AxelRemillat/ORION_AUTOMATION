/**
 * Modèles OpenAI, un par rôle de la chaîne d'emails.
 *
 *   extraction → PROFIL MÉTIER → STRATÈGE → RÉDACTEUR → JUGE
 *
 * Chaque rôle lit sa variable d'environnement serveur. Sans elle, il retombe
 * sur `OPENAI_MODEL`, puis sur `gpt-4o-mini` : c'est exactement le
 * comportement d'avant ce module. Rien ne change tant que les variables ne
 * sont pas renseignées.
 *
 * Module sans dépendance : importable par les routes comme par les scripts.
 */

export const AI_ROLES = ["extract", "profile", "strategist", "writer", "judge"] as const;
export type AiRole = (typeof AI_ROLES)[number];

/** Variable d'environnement de chaque rôle. */
export const MODEL_ENV: Record<AiRole, string> = {
  extract: "OPENAI_MODEL_EXTRACT",
  profile: "OPENAI_MODEL_PROFILE",
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
  profile: null,
  strategist: null,
  writer: null,
  extract: null,
  judge: null,
};

type Env = Record<string, string | undefined>;

/**
 * Défauts DEMANDÉS explicitement pour un rôle, avant le repli global.
 *
 * Le profil métier lit trois pages de site et rend un JSON court : Axel a
 * choisi gpt-6-luna pour ce rôle. OPENAI_MODEL_PROFILE le remplace.
 */
export const ROLE_DEFAULTS: Partial<Record<AiRole, string>> = {
  profile: "gpt-6-luna",
};

/** Modèle effectif d'un rôle. */
export function modelFor(role: AiRole, env: Env = process.env): string {
  return (
    env[MODEL_ENV[role]]?.trim() || ROLE_DEFAULTS[role] || env.OPENAI_MODEL?.trim() || LEGACY_DEFAULT_MODEL
  );
}

export type ReasoningEffort = "low" | "medium" | "high";
const EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high"];

/**
 * Effort de raisonnement d'un rôle : OPENAI_REASONING_EFFORT_<ROLE>, sinon « low » partout.
 * Cowork #54 : le stratège passe de « medium » à « low » — même taux de mails prêts sur le même lot
 * (8/11 en « low » contre 7/11 en « medium »), sortie ~40 % plus courte (raisonnement ÷ 3).
 * `OPENAI_REASONING_EFFORT_STRATEGIST=medium` rétablit l'ancien réglage.
 *
 * Il n'est ENVOYÉ que si le modèle le supporte — c'est `lib/ai/params.ts` qui
 * en décide. Ce module ne dit plus rien des capacités : la détection par
 * expression régulière sur le nom (`/^(o\d|gpt-5)/`) a laissé passer
 * `gpt-6-*` et fait tomber toute la chaîne en 400.
 */
export function reasoningEffortFor(role: AiRole, env: Env = process.env): ReasoningEffort {
  const raw = env[`OPENAI_REASONING_EFFORT_${role.toUpperCase()}`]?.trim().toLowerCase();
  if (raw && (EFFORTS as readonly string[]).includes(raw)) return raw as ReasoningEffort;
  return "low";
}
