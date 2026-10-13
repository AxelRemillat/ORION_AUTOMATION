/**
 * Clés VAPID du Web Push (Cowork #28). Elles vivent dans les variables Vercel,
 * JAMAIS dans le dépôt. Génération : `npx web-push generate-vapid-keys`.
 *
 *   VAPID_PUBLIC_KEY   clé publique (envoyée au navigateur à l'abonnement)
 *   VAPID_PRIVATE_KEY  clé privée (serveur seulement, jamais affichée)
 *   VAPID_SUBJECT      contact de l'émetteur : « mailto:… » ou une URL https
 *
 * Tant qu'une des trois manque, rien n'est envoyé et Réglages affiche
 * « Notifications non configurées ».
 */
export const VAPID_ENV = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** La seule partie montrable : la clé publique (ou null si non configuré). */
export const vapidPublicKey = (env?: Record<string, string | undefined>): string | null => vapidConfig(env)?.publicKey ?? null;
