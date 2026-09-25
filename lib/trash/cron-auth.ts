import { timingSafeEqual } from "node:crypto";

/**
 * Autorisation des appels cron : Vercel envoie `Authorization: Bearer
 * <CRON_SECRET>`. Sans secret configuré, tout est refusé — une route de purge
 * ne doit jamais être ouverte par défaut.
 */
export function authorizeCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
