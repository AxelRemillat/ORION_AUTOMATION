/**
 * MODE DÉMO LOCAL (Cowork #117) : captures d'écran et tests Playwright du CRM sans base ni compte.
 *
 * Actif seulement si les DEUX conditions sont réunies : `NODE_ENV !== "production"` ET `ORION_DEMO=1`. Sur Vercel,
 * `NODE_ENV` vaut toujours « production » (preview comprise) : le mode démo ne peut pas s'y allumer, même si la
 * variable était posée par erreur. En démo : pas de session exigée, données du CRM en mémoire (lib/crm/memoire.ts),
 * badges à zéro. Rien n'est lu ni écrit dans Supabase.
 */
export function modeDemo(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.ORION_DEMO === "1";
}

export const UTILISATEUR_DEMO = { id: "00000000-0000-0000-0000-00000000de30", email: "demo@orion.local" } as const;
