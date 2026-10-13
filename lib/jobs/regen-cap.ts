import type { Db } from "@/lib/trash/scope";

/**
 * PLAFOND DES RÉGÉNÉRATIONS AUTOMATIQUES (Cowork #56).
 *
 * Mesure du 13/10/2026 : 5,6 rédactions par intro sur 14 jours, premier poste de coût OpenAI. Par fiche :
 * une rédaction initiale (avec ses 2 réécritures internes), puis AU PLUS UNE régénération AUTOMATIQUE
 * (préparation du matin, fiche complétée, lot) par 7 jours glissants. Au-delà, la fiche passe « À revoir »
 * avec le motif, sans aucun appel de modèle.
 *
 * Jamais limité : les régénérations MANUELLES d'Axel (bouton), et les jobs d'agents (`source` agent*), qui
 * sont des mesures comptées à part.
 */

export const AUTO_REGEN_WINDOW_DAYS = 7;
export const AUTO_REGEN_MAX = 1;
const DAY = 86_400_000;

/** Génération déjà faite pour la fiche : job `email_generate` terminé. */
export interface PastGeneration {
  createdAt: string;
  auto: boolean;
}

const day = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" }).format(new Date(iso));

/**
 * Motif du refus, ou `null` si la génération automatique est permise. `history` : générations terminées de la
 * fiche (toutes origines). La première de toutes est la rédaction initiale ; chaque génération automatique
 * suivante dans la fenêtre est une régénération.
 */
export function autoRegenRefusal(history: readonly PastGeneration[], now: Date = new Date()): string | null {
  if (!history.length) return null;
  const sorted = [...history].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const initial = sorted[0];
  const since = now.getTime() - AUTO_REGEN_WINDOW_DAYS * DAY;
  const regens = sorted.filter((entry) => entry !== initial && entry.auto && Date.parse(entry.createdAt) >= since);
  if (regens.length < AUTO_REGEN_MAX) return null;
  const last = regens[regens.length - 1];
  return `Régénération automatique déjà faite le ${day(last.createdAt)} (au plus ${AUTO_REGEN_MAX} par ${AUTO_REGEN_WINDOW_DAYS} jours) : régénérez à la main si besoin.`;
}

/** Source d'un job lancé par un script d'agent (`agent1`…) : mesure, jamais plafonnée ni comptée en prod. */
export const isAgentSource = (source: string | null | undefined): boolean => Boolean(source && /^agent/i.test(source));

/** Générations RÉELLES de la fiche : jobs `email_generate` terminés AVEC un brouillon (`result.messageId`) — un job
 *  arrêté par une porte (faits insuffisants, À revoir) n'a rien rédigé et ne compte pas. Le job en cours est exclu. */
export async function loadPastGenerations(db: Db, input: { userId: string; prospectId: string; currentJobId: string }): Promise<PastGeneration[]> {
  const { data } = await db
    .from("jobs")
    .select("id, created_at, params, result")
    .eq("user_id", input.userId)
    .eq("type", "email_generate")
    .eq("status", "done")
    .contains("params", { prospectId: input.prospectId })
    .order("created_at", { ascending: true })
    .limit(200);
  return ((data ?? []) as { id: string; created_at: string; params: { auto?: boolean; source?: string } | null; result: { messageId?: string } | null }[])
    .filter((row) => row.id !== input.currentJobId && Boolean(row.result?.messageId) && !isAgentSource(row.params?.source))
    .map((row) => ({ createdAt: row.created_at, auto: row.params?.auto === true }));
}

/** Paramètre `source` d'un job créé par un script : la source `agent*` du poste (USAGE_SOURCE), sinon rien. */
export function scriptJobSource(env: Record<string, string | undefined> = process.env): { source?: string } {
  const raw = env.USAGE_SOURCE?.trim().toLowerCase() ?? "";
  return isAgentSource(raw) ? { source: raw.replace(/[^a-z0-9_-]/g, "").slice(0, 32) } : {};
}
