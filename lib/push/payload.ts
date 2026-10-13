import { firstSentence } from "@/lib/notify/ntfy";

/**
 * NOTIFICATIONS SUR LE PC (Web Push, Cowork #28) — contenu et lien, règles pures.
 *
 * Deux événements, et rien d'autre :
 *   - une vraie réponse d'un prospect → « Réponse de ARTFLEX » ;
 *   - une offre qui passe en Alerte    → « Codeur · Refaire mon site internet · Lancement ».
 * Le lien est un CHEMIN (même origine que le service worker) : le clic ouvre la
 * fiche, le mail ou l'offre concernée.
 */
export type PushKind = "reply" | "alerte" | "test";

export interface PushPayload {
  kind: PushKind;
  title: string;
  body: string;
  /** Chemin ORION ouvert au clic. */
  url: string;
}

const PLATFORMS: Record<string, string> = { codeur: "Codeur", upwork: "Upwork", comeup: "ComeUp", malt: "Malt" };
const LANES: Record<string, string> = { lancement: "Lancement", regie: "Régie" };

export const platformLabel = (platform: string): string => PLATFORMS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);

export function replyPayload(input: { inboundId: string; prospectId: string | null; companyName: string | null; fromEmail: string; body?: string | null }): PushPayload {
  return {
    kind: "reply",
    title: `Réponse de ${input.companyName?.trim() || input.fromEmail}`,
    body: firstSentence(input.body ?? "", 100),
    url: input.prospectId ? `/suivi/${encodeURIComponent(input.prospectId)}` : `/cockpit/inbox/${encodeURIComponent(input.inboundId)}`,
  };
}

/** Le dernier segment dit POURQUOI c'est une alerte : la voie, sinon le score. */
export function alertPayload(input: { id: string; platform: string; title: string; lane: string | null; score: number | null }): PushPayload {
  const why = (input.lane && LANES[input.lane]) || (input.score != null ? `${input.score}/10` : "Alerte");
  return {
    kind: "alerte",
    title: `${platformLabel(input.platform)} · ${input.title.trim()} · ${why}`,
    body: "",
    url: `/opportunites?id=${encodeURIComponent(input.id)}`,
  };
}

export const TEST_PAYLOAD: PushPayload = { kind: "test", title: "Test ORION", body: "Les notifications arrivent bien sur cet appareil.", url: "/aujourdhui" };
