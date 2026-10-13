/**
 * Côté navigateur des notifications PC (Cowork #28) : service worker et
 * abonnement Web Push. La permission n'est demandée QUE sur un clic.
 */
export const SW_URL = "/orion-sw.js";

export const pushSupported = (): boolean =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Clé publique VAPID (base64url) → octets attendus par `pushManager.subscribe`. */
export function vapidKeyBytes(base64url: string): Uint8Array {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Au clic sur « Activer » : permission, service worker, abonnement. */
export async function enablePush(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permission refusée : autorisez les notifications pour ORION dans le navigateur.");
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(publicKey) as BufferSource });
}
