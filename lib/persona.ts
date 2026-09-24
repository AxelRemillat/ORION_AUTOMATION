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

  /**
   * Preuves concretes, taguees par famille de besoin.
   *
   * Regle absolue : on ne cite JAMAIS un employeur, le client d'une alternance
   * ni un projet sous NDA. Ce sont donc des descriptions de ce qu'Axel sait
   * construire — vraies, verifiables dans une conversation, et sans nom propre.
   * `publicOk` rend le filtre explicite : une preuve passee a false ne sortira
   * jamais dans un mail, meme si quelqu'un l'ajoute par inadvertance.
   */
  proofs: [
    {
      id: "p1",
      tags: ["documents", "contrats", "rh", "interim", "saisie"],
      publicOk: true,
      text: "j'ai deja construit des chaines qui lisent les documents entrants et pre-remplissent les pieces a produire",
    },
    {
      id: "p2",
      tags: ["maintenance", "supervision", "interventions", "stock", "terrain"],
      publicOk: true,
      text: "j'ai relie des flux d'alertes a des declenchements automatiques cote commande et planification",
    },
    {
      id: "p3",
      tags: ["email", "support", "relance", "client"],
      publicOk: true,
      text: "j'ai mis en place du tri et des relances automatiques sur des boites mail a fort volume",
    },
    {
      id: "p4",
      tags: ["rag", "recherche", "connaissance", "documentation"],
      publicOk: true,
      text: "j'ai construit des systemes qui repondent directement sur une base documentaire interne",
    },
    {
      id: "p5",
      tags: ["reporting", "donnees", "consolidation", "energie"],
      publicOk: true,
      text: "j'ai automatise des reportings recurrents a partir de donnees eparpillees dans plusieurs outils",
    },
  ],
} as const;

export interface PersonaProof {
  id: string;
  tags: readonly string[];
  publicOk: boolean;
  text: string;
}

/**
 * Preuve la plus proche du pain vise, ou `null`.
 *
 * Aucune correspondance renvoie `null` a dessein : le prompt dit alors de
 * decrire ce qu'Axel construit, plutot que de sortir une preuve hors sujet.
 */
export function pickProof(painText: string): PersonaProof | null {
  const haystack = painText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  let best: { proof: PersonaProof; score: number } | null = null;
  for (const proof of PERSONA.proofs as readonly PersonaProof[]) {
    if (!proof.publicOk) continue;
    const score = proof.tags.filter((tag) => haystack.includes(tag)).length;
    if (score > 0 && (!best || score > best.score)) best = { proof, score };
  }
  return best?.proof ?? null;
}

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
