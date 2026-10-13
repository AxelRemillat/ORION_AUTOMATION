import { hunterStatus, markHunterExhausted, type HunterGateStore } from "@/lib/hunter/gate";

/**
 * VÉRIFICATION HUNTER AVANT ENVOI (Cowork #26) — intro ET relance, jamais une réponse.
 *
 * Toute adresse est vérifiée (Hunter Email Verifier) avant qu'un mail parte ; le résultat
 * est gardé 30 JOURS (clé `verif-envoi:<adresse>` dans `enrichment_cache`) : la vérification
 * faite à la programmation sert au départ, sans seconde dépense.
 *   - « invalid »                        → envoi BLOQUÉ, avec le motif ;
 *   - « accept_all », « unknown », etc.   → envoi autorisé, adresse SIGNALÉE « risquée » ;
 *   - « valid », « webmail »              → envoi autorisé.
 * Sans clé Hunter, budget du jour atteint ou panne : l'envoi n'est jamais bloqué faute de
 * vérification (on ne sait pas, on n'invente pas) — c'est noté « non vérifiée ».
 *
 * Coût lu sur l'API (/v2/account, offre Starter, 13/10/2026) : 2 000 crédits = 4 000
 * vérifications → 0,5 crédit par vérification.
 */
export const VERIFY_TTL_MS = 30 * 86_400_000;
export const CREDITS_PER_VERIFICATION = 0.5;

export type HunterVerifierStatus = "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | "unknown";
export type RecipientVerdict = "ok" | "risquee" | "bloquee" | "non_verifiee";

export interface RecipientCheck {
  email: string;
  status: HunterVerifierStatus | null;
  verdict: RecipientVerdict;
  source: "cache" | "hunter" | "indisponible";
  /** Motif à afficher (blocage ou signalement). */
  reason: string | null;
}

/** Verdict d'envoi d'un statut Hunter. */
export function verdictOf(status: HunterVerifierStatus | null): RecipientVerdict {
  if (status === null) return "non_verifiee";
  if (status === "invalid") return "bloquee";
  return status === "valid" || status === "webmail" ? "ok" : "risquee";
}

const REASONS: Partial<Record<RecipientVerdict, (email: string, status: string | null) => string>> = {
  bloquee: (email) => `Adresse ${email} invalide (vérification Hunter) : l'envoi partirait en rebond`,
  risquee: (email, status) => `Adresse ${email} non confirmée par Hunter (${status}) : envoi autorisé, à surveiller`,
};

export interface RecipientDeps {
  read: (key: string) => Promise<{ status: HunterVerifierStatus } | null>;
  write: (key: string, value: { status: HunterVerifierStatus; at: string }) => Promise<void>;
  /** Appel Hunter réel ; `null` = indisponible (panne, pas de clé) ; `quotaExceeded` coupe Hunter jusqu'au lendemain. */
  verify: ((email: string) => Promise<{ status: HunterVerifierStatus | null; quotaExceeded: boolean }>) | null;
  /**
   * Garde-fou Hunter : seuls les CRÉDITS ÉPUISÉS du compte arrêtent la vérification. Le budget
   * du jour sert aux recherches ; la vérification avant envoi est déjà bornée par le plafond
   * d'envoi (30 mails par jour au plus = 15 crédits), elle ne doit pas s'éteindre avec lui.
   */
  gate?: HunterGateStore;
  /** Trace de l'usage facturé (api_usage). */
  record?: (status: HunterVerifierStatus) => Promise<void>;
  now?: Date;
}

export const verifyKey = (email: string) => `verif-envoi:${email.trim().toLowerCase()}`;

export async function checkRecipient(email: string, deps: RecipientDeps): Promise<RecipientCheck> {
  const address = email.trim().toLowerCase();
  const done = (status: HunterVerifierStatus | null, source: RecipientCheck["source"]): RecipientCheck => {
    const verdict = verdictOf(status);
    return { email: address, status, verdict, source, reason: REASONS[verdict]?.(address, status) ?? null };
  };
  const cached = await deps.read(verifyKey(address)).catch(() => null);
  if (cached?.status) return done(cached.status, "cache");
  if (!deps.verify) return done(null, "indisponible");
  const gate = deps.gate ? await hunterStatus(deps.gate, deps.now).catch(() => ({ blocked: null })) : null;
  if (gate?.blocked?.includes("crédits du compte épuisés")) return done(null, "indisponible");
  const result = await deps.verify(address).catch(() => ({ status: null, quotaExceeded: false }));
  if (result.quotaExceeded) markHunterExhausted(deps.now);
  if (!result.status) return done(null, "indisponible");
  await deps.write(verifyKey(address), { status: result.status, at: (deps.now ?? new Date()).toISOString() }).catch(() => undefined);
  await deps.record?.(result.status).catch(() => undefined);
  return done(result.status, "hunter");
}
