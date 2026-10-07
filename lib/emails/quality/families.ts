import { DEMO_HOST, type DemoLink } from "./demo-links";
import type { SubjectArm } from "./experiment";
import type { MailParts } from "./template";

/**
 * EXPÉRIENCE N° 2 — QUATRE FAMILLES DE MAILS (Axel, 05/10/2026).
 *
 *   F1 « Problème métier »      : fait propre → conséquence → « J'automatise… » → démo → 15 min (le gabarit validé).
 *   F2 « Présentation directe » : « Je me permets de vous contacter : je suis Axel Remillat… » → besoin probable
 *                                  lié à son activité → démo « proche de ce que vous pourriez avoir chez vous » → 15 min.
 *   F3 « Question courte »      : ≤ 55 mots — qui gère la tâche ? → ce que je fais → démo → 15 min.
 *   F4 « Démo d'abord »         : le lien en première ligne → ce que la démo fait sur un cas type de son métier
 *                                  → qui je suis en une ligne → 15 min.
 *
 * ROUTAGE selon la donnée : F1 et F3 partent d'un fait propre et d'une tâche
 * sûre ; sans fait vérifié solide (« pain incertain », profil trop mince), seules
 * F2 et F4 — qui n'exigent que l'activité et le secteur — sont permises.
 *
 * ATTRIBUTION : hachage stable de l'identifiant entre les familles permises
 * (même principe que l'expérience n° 1, mise en pause : l'objet suit la
 * famille). La famille est enregistrée dans `message_variants.family`, et le
 * lien de démo porte `&f=<famille>` pour mesurer les clics par famille.
 */

export type MailFamily = "F1" | "F2" | "F3" | "F4";
export const ALL_FAMILIES: readonly MailFamily[] = ["F1", "F2", "F3", "F4"];
/** Sans fait vérifié solide : activité + secteur suffisent à ces deux familles. */
export const THIN_DATA_FAMILIES: readonly MailFamily[] = ["F2", "F4"];

export const FAMILY_LABELS: Record<MailFamily, string> = {
  F1: "Problème métier",
  F2: "Présentation directe",
  F3: "Question courte",
  F4: "Démo d'abord",
};

export const FAMILY_EXPERIMENT = "familles-1";

/** Présentation imposée de F2, posée par le code. */
export const F2_INTRO = "Je me permets de vous contacter : je suis Axel Remillat, freelance en IA et automatisation de tâches pour les PME.";
/** Qui je suis, en une ligne (F4), posé par le code. */
export const F4_WHO = "Je suis Axel Remillat, freelance en IA et automatisation de tâches pour les PME.";
/** Demande courte de F3 (le mail tient en 55 mots). */
export const F3_CTA = "Auriez-vous 15 minutes la semaine prochaine pour en parler ?";

/** Corps (salutation → demande), sans « stop » ni signature. */
/**
 * Grille Cowork (06/10/2026) : 75 mots au plus, 55 pour F3. F2 garde 5 mots de
 * plus : sa présentation imposée (18 mots) et sa ligne de démo imposée en
 * prennent déjà la moitié.
 */
export const FAMILY_LIMITS: Record<MailFamily, { min: number; max: number }> = {
  F1: { min: 45, max: 75 },
  F2: { min: 50, max: 80 },
  F3: { min: 30, max: 55 },
  // F4 (Cowork #34) : fait + problème PUIS la démo en preuve — 5 mots de plus que F1.
  F4: { min: 45, max: 80 },
};

export function isFamily(value: unknown): value is MailFamily {
  return typeof value === "string" && (ALL_FAMILIES as readonly string[]).includes(value);
}

/** Familles permises pour ce prospect : F1 et F3 exigent un fait propre et une tâche sûre. */
export function allowedFamilies(solidFacts: boolean): readonly MailFamily[] {
  return solidFacts ? ALL_FAMILIES : THIN_DATA_FAMILIES;
}

/** Famille d'un prospect : stable, répartie uniformément entre les familles permises (FNV-1a). */
export function familyFor(prospectId: string, allowed: readonly MailFamily[] = ALL_FAMILIES): MailFamily {
  let hash = 0x811c9dc5;
  for (const char of `${FAMILY_EXPERIMENT}:${prospectId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return allowed[hash % allowed.length] ?? "F1";
}

/** Expérience n° 1 en pause : l'objet suit la famille (question pour F3, sujet métier sinon). */
export const subjectArmFor = (family: MailFamily): SubjectArm => (family === "F3" ? "question" : "metier");

/**
 * URL de démo suivie, DISCRÈTE (Cowork, 05/10/2026) : « &f=F4 » en clair fait
 * « lien traqué » et peut peser en délivrabilité. La famille tient dans un
 * chiffre : `?demo=invoice&v=4` (ou `/agent?v=4`). Rien à changer côté portfolio :
 * un paramètre inconnu est ignoré par la page.
 */
export const FAMILY_PARAM: Record<MailFamily, string> = { F1: "1", F2: "2", F3: "3", F4: "4" };

export function familyDemoUrl(demo: DemoLink, family: MailFamily): string {
  return `${DEMO_HOST}${demo.path}${demo.path.includes("?") ? "&" : "?"}v=${FAMILY_PARAM[family]}`;
}

/** URL nue (sans le marqueur de famille, ancien `f=F4` compris), pour la vérifier contre la liste blanche. */
export const bareDemoUrl = (url: string) => url.replace(/[?&](v=[1-4]|f=F[1-4])\b/, "");

export const PROOF_PREFIXES: Record<MailFamily, string> = {
  F1: "Exemple testable en une minute :",
  F2: "Une démo proche de ce que vous pourriez avoir chez vous :",
  F3: "Exemple testable en une minute :",
  F4: "Une démo testable en une minute :",
};

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Corps d'une famille, SANS mention « stop » ni signature. Le modèle n'écrit que l'objet, `hook` et `proposal`. */
export function assembleFamily(family: MailFamily, parts: MailParts, frame: { greeting: string; demo: DemoLink; cta: string }): string {
  const proof = `${PROOF_PREFIXES[family]} ${familyDemoUrl(frame.demo, family)}`;
  switch (family) {
    case "F2":
      return [frame.greeting, F2_INTRO, clean(parts.hook), clean(parts.proposal), proof, frame.cta].join("\n\n");
    case "F3":
      return [frame.greeting, clean(parts.hook), clean(parts.proposal), proof, F3_CTA].join("\n\n");
    case "F4":
      // Cowork #34 : jamais d'ouverture par la démo. Fait propre + problème, puis la démo comme PREUVE.
      return [frame.greeting, clean(parts.hook), proof, clean(parts.proposal), frame.cta].join("\n\n");
    default:
      return [frame.greeting, clean(parts.hook), clean(parts.proposal), proof, frame.cta].join("\n\n");
  }
}

/** Le texte dont la démo doit être l'illustration : la proposition, ou (F4) la description de la démo. */
export const demoTextOf = (_family: MailFamily, parts: MailParts) => parts.proposal;
