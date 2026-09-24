/**
 * Qui écrit les emails.
 *
 * Ce module est la source unique de l'identité d'Axel telle qu'elle apparaît
 * dans un mail à froid. Il est volontairement séparé du prompt : la façon de
 * se présenter change plus souvent que les règles de rédaction, et on ne veut
 * pas avoir à relire un prompt de cent lignes pour corriger une phrase de bio.
 *
 * Module sans dépendance : importable côté serveur comme côté client.
 */

/** Lien de prise de rendez-vous, glissé dans le CTA. */
export const BOOKING_URL = process.env.NEXT_PUBLIC_BOOKING_URL ?? "";

export const PERSONA = {
  firstName: "Axel",
  fullName: "Axel Remillat",

  /**
   * Comment il se présente en une ligne.
   *
   * « Étudiant » et « alternant » sont proscrits dans un mail : vrais, mais
   * hors sujet pour un dirigeant qui évalue une prestation. Ce qui compte
   * c'est ce qu'il sait faire.
   */
  headline: "ingénieur freelance en IA, spécialisé en automatisation de tâches",

  /** Le détail technique, quand il y a la place de préciser. */
  expertise: [
    "workflows n8n",
    "agents IA",
    "systèmes RAG",
    "intégration Azure / Microsoft 365 / Google",
  ],

  /** Ce qu'il vend, formulé côté bénéfice client. */
  offer:
    "aider les PME et les startups à automatiser leurs process — commandes, " +
    "livraisons, back-office, tâches administratives — et à mettre leur IA en " +
    "production de façon fiable et rentable",

  /**
   * Preuve sociale. UNIQUEMENT ce qui est vrai.
   *
   * Pas de nom de client, pas de logo, pas de « +50 entreprises accompagnées ».
   * Cette phrase est le plafond de ce qui peut être affirmé.
   */
  socialProof:
    "j'ai déjà mis en place ce type d'automatisation dans des projets en " +
    "startup et en entreprise",

  signature: "Axel",
} as const;

/**
 * Bloc d'identité injecté dans le prompt.
 * Rédigé à la première personne : le modèle écrit EN TANT QU'Axel, il ne
 * rédige pas une fiche sur lui.
 */
export function personaBlock(): string {
  const cta = BOOKING_URL
    ? `Lien de prise de rendez-vous à placer dans le CTA, tel quel : ${BOOKING_URL}`
    : "Aucun lien de rendez-vous n'est configuré : propose simplement de répondre au mail. " +
      "N'invente pas d'URL, ne mets pas de lien vide ni de crochets à compléter.";

  return `QUI TU ES (tu écris en son nom, à la première personne)
- ${PERSONA.fullName}, ${PERSONA.headline}.
- Domaines : ${PERSONA.expertise.join(", ")}.
- Ce que tu fais : ${PERSONA.offer}.
- Preuve que tu peux avancer, et RIEN de plus : « ${PERSONA.socialProof} ».
  Aucun nom de client, aucun chiffre de portefeuille, aucune référence inventée.
- Ne mentionne JAMAIS un statut d'étudiant ou d'alternant.
- Signature : « ${PERSONA.signature} ».
- ${cta}`;
}
