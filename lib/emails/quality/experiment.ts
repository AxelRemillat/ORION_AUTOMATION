/**
 * EXPÉRIENCE N° 1 — le STYLE DE L'OBJET, seul (Cowork, 05/10/2026).
 *
 *   A « metier »   : sujet métier court, sans question — « Commandes de consommables »
 *   B « question » : question courte — « Vos confirmations de délai ? »
 *
 * Affectation 50/50 par hachage de l'identifiant du prospect : équivalent à un
 * tirage au sort (aucun lien avec le contenu de la fiche), et STABLE — un
 * brouillon régénéré garde son bras, sinon la mesure se brouille. Tout le reste
 * du mail suit les règles actuelles : une seule expérience à la fois.
 *
 * Le bras est enregistré dans `message_variants.subject_style`
 * (lib/variants/record.ts) ; les taux par bras sont dans Réglages › Données.
 */

export const SUBJECT_EXPERIMENT = "objet-1";
export type SubjectArm = "metier" | "question";
export const SUBJECT_ARMS: readonly SubjectArm[] = ["metier", "question"];

/** Bras d'un prospect : stable, réparti 50/50 (FNV-1a sur l'identifiant). */
export function subjectArm(prospectId: string): SubjectArm {
  let hash = 0x811c9dc5;
  for (const char of `${SUBJECT_EXPERIMENT}:${prospectId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return SUBJECT_ARMS[hash % 2];
}

/** Consigne d'objet pour le rédacteur, selon le bras. */
export function subjectInstruction(arm: SubjectArm): string {
  return arm === "question"
    ? `OBJET — UNE QUESTION COURTE de 3 à 6 mots, qui finit par « ? », sur la tâche du métier (« Vos confirmations de délai ? », « Qui trie les demandes de prix ? »). Majuscule initiale puis minuscules. Ni forme juridique, ni « Automatisation de ».`
    : `OBJET — un SUJET MÉTIER court de 2 à 5 mots, SANS question ni point d'interrogation (« Commandes de consommables », « Demandes de prix »). Majuscule initiale puis minuscules. Ni forme juridique, ni « Automatisation de ».`;
}

/** L'objet respecte-t-il son bras ? Motif sinon (pour la réécriture). */
export function subjectArmProblem(subject: string, arm: SubjectArm): string | null {
  const text = subject.trim();
  const words = text.replace(/\?$/, "").trim().split(/\s+/).filter(Boolean).length;
  if (arm === "question") {
    if (!text.endsWith("?")) return "Objet (expérience, bras « question ») : une question courte qui finit par « ? ».";
    if (words < 3 || words > 6) return `Objet (bras « question ») : ${words} mots, il en faut 3 à 6.`;
    return null;
  }
  if (text.includes("?")) return "Objet (expérience, bras « métier ») : pas de question, un sujet métier court.";
  if (words < 2 || words > 5) return `Objet (bras « métier ») : ${words} mots, il en faut 2 à 5.`;
  return null;
}
