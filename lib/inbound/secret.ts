import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Secret partagé du webhook entrant.
 *
 * Isolé dans son module parce qu'un fichier `route.ts` d'App Router ne peut
 * rien exporter d'autre que ses handlers et sa configuration : y ajouter une
 * fonction utilitaire fait échouer le build (« Property 'secretMatches' is
 * incompatible with index signature »). Elle est donc ici — et devient
 * testable au passage.
 */

/** En-tête portant le secret partagé avec n8n. */
export const INBOUND_SECRET_HEADER = "x-orion-inbound-secret";

/**
 * Comparaison à temps constant.
 *
 * On compare des empreintes plutôt que les chaînes brutes : `timingSafeEqual`
 * exige deux tampons de même longueur, et passer par un hash évite de laisser
 * fuiter la longueur du secret.
 */
export function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
